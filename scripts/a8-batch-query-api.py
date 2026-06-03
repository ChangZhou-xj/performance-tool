#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工单查询脚本 - 纯 HTTP 版本（不依赖 Playwright）

从流程图中提取开发人员和当前处理人信息。

数据获取流程：
  1. 登录：POST /seeyon/main.do?method=login（DES 加密密码）
  2. 待办列表：GET listPending → 从 fillmaps JSON 获取 affairId/processId/caseId
  3. 工单 summary：GET summary → 提取 wfDiagram_v
  4. 流程图：GET showDiagram + wfDiagram_v → 解析 processXml/caseLogXml/caseWorkitemLogXml
  5. 输出：项目对接人员 + 当前处理人

用法:
  python3 a8-batch-query-api.py '{"ticketNos":["KFXQ-CX-xxx"],"loginUrl":"http://...","username":"xxx","password":"xxx"}'
  python3 a8-batch-query-api.py --file params.json

输出:
  RESULT:{"ticketNo":"xxx","developer":"张三","currentHandler":"李四"}
  RESULT:{"ticketNo":"yyy","developer":null,"currentHandler":null}
"""

import sys
import json
import re
import os
import hashlib
import base64
import time
from urllib.parse import urljoin, urlencode

# Windows 上 Python stdout 默认使用 GBK 编码，而 Node.js 以 UTF-8 解码，
# 导致中文乱码。强制 stdout 使用 UTF-8 编码。
if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    from Crypto.Cipher import DES
except ImportError:
    try:
        from Cryptodome.Cipher import DES
    except ImportError:
        DES = None


class A8APIClient:
    """A8 系统 HTTP API 客户端"""

    def __init__(self, base_url, login_url, username, password):
        self.base_url = base_url.rstrip('/')
        self.login_url = login_url
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.logged_in = False

    # ─── 登录 ───────────────────────────────────────────

    @staticmethod
    def _des_encrypt_openssl(plaintext, passphrase):
        """CryptoJS.DES.encrypt 兼容的 DES-CBC 加密（OpenSSL 格式）"""
        passphrase_bytes = passphrase.encode('utf-8')
        salt = os.urandom(8)
        d = hashlib.md5(passphrase_bytes + salt).digest()
        key, iv = d[:8], d[8:16]
        plain_bytes = plaintext.encode('utf-8')
        pad_len = 8 - (len(plain_bytes) % 8)
        padded = plain_bytes + bytes([pad_len] * pad_len)
        cipher = DES.new(key, DES.MODE_CBC, iv)
        encrypted = cipher.encrypt(padded)
        result = b'Salted__' + salt + encrypted
        return base64.b64encode(result).decode('utf-8')

    @staticmethod
    def _extract_security_seed(html):
        """从登录页 HTML 中提取 _SecuritySeed 值"""
        m = re.search(r"_SecuritySeed\s*=\s*'(-?\d+)'", html)
        if m:
            return m.group(1)
        m = re.search(r'_SecuritySeed\s*=\s*"(-?\d+)"', html)
        if m:
            return m.group(1)
        return None

    def login(self):
        """登录 A8 系统"""
        print(f"INFO: 正在登录 A8 ({self.login_url})...", file=sys.stderr)

        if DES is None:
            print("ERROR: pycryptodome 未安装。Run: pip install pycryptodome", file=sys.stderr)
            return False

        # GET 登录页
        try:
            resp = self.session.get(self.login_url, timeout=30)
        except requests.exceptions.ConnectionError as e:
            print(f"ERROR: 无法连接 A8: {e}", file=sys.stderr)
            return False

        # 处理 meta refresh 跳板页
        if 'login_username' not in resp.text and len(resp.text) < 500:
            meta_match = re.search(
                r'<meta[^>]+http-equiv=["\']Refresh["\'][^>]+url=([^"\'>\s]+)',
                resp.text, re.IGNORECASE
            )
            if meta_match:
                refresh_url = meta_match.group(1)
                if not refresh_url.startswith('http'):
                    refresh_url = f"{self.base_url}{refresh_url}"
                print(f"INFO: 跟随 meta refresh → {refresh_url}", file=sys.stderr)
                resp = self.session.get(refresh_url, timeout=30)

        # 已处于登录状态
        if 'indexOpenWindow' in resp.url or ('您好' in resp.text and 'login_username' not in resp.text):
            self.logged_in = True
            print("INFO: 已处于登录状态", file=sys.stderr)
            return True

        # 提取 _SecuritySeed 并加密密码
        seed = self._extract_security_seed(resp.text)
        if seed:
            print(f"INFO: _SecuritySeed={seed}", file=sys.stderr)
            encrypted_pwd = self._des_encrypt_openssl(self.password, seed)
        else:
            print("WARN: 未找到 _SecuritySeed", file=sys.stderr)
            encrypted_pwd = self.password

        # POST 登录
        login_action = f"{self.base_url}/seeyon/main.do?method=login"
        data = {
            'login_username': self.username,
            'login_password': encrypted_pwd,
            'login_password1': '',
            'login_validatePwdStrength': '4',
            'login.timezone': 'Asia/Shanghai',
            'fontSize': '12',
            'screenWidth': '1920',
            'screenHeight': '1080',
        }
        resp = self.session.post(login_action, data=data, timeout=30, allow_redirects=True)
        text = resp.text

        if 'login_username' in text and 'login_password1' in text:
            print(f"ERROR: 登录失败 (url={resp.url})", file=sys.stderr)
            return False

        if 'indexOpenWindow' in str(resp.url) or '系统加载中' in text or '您好' in text:
            self.logged_in = True
            print(f"INFO: 登录成功 (url={resp.url})", file=sys.stderr)
            return True

        if text.strip().startswith('ok'):
            self.logged_in = True
            print("INFO: 登录成功（返回 ok）", file=sys.stderr)
            return True

        if resp.status_code == 200 and 'login_username' not in text:
            self.logged_in = True
            print(f"INFO: 登录成功（降级判断）", file=sys.stderr)
            return True

        print(f"WARN: 登录状态不确定, url={resp.url}", file=sys.stderr)
        return False

    # ─── 待办列表 ────────────────────────────────────────

    def get_pending_list(self, page=1, rows=100):
        """获取待办列表，返回 fillmaps 中的 data 数组"""
        url = f"{self.base_url}/seeyon/collaboration/collaboration.do?method=listPending"
        resp = self.session.get(url, params={'page': page, 'rows': rows}, timeout=30)
        if resp.status_code != 200:
            print(f"ERROR: 获取待办列表失败, status={resp.status_code}", file=sys.stderr)
            return []

        match = re.search(r'\$\.ctx\.fillmaps\s*=\s*(\{.*?\})\s*;', resp.text, re.DOTALL)
        if not match:
            print("WARN: 未找到 fillmaps 数据", file=sys.stderr)
            return []

        try:
            fillmaps = json.loads(match.group(1))
        except json.JSONDecodeError:
            print("WARN: fillmaps JSON 解析失败", file=sys.stderr)
            return []

        try:
            data_list = fillmaps['listPending']['data']
        except (KeyError, TypeError):
            try:
                data_list = fillmaps['data']['listPending']['data']
            except (KeyError, TypeError):
                print(f"WARN: fillmaps 结构异常, keys={list(fillmaps.keys())}", file=sys.stderr)
                return []

        print(f"INFO: 待办列表 {len(data_list)} 条", file=sys.stderr)
        return data_list

    # ─── 流程图数据提取 ──────────────────────────────────

    def get_summary_and_workflow(self, affair_id, affair_node_name=None):
        """获取 summary 页面 + 流程图 HTML，提取开发人员和当前处理人

        Args:
            affair_id: 工单 affairId
            affair_node_name: fillmaps 中的 affairNodeName（用于匹配当前活跃节点）

        Returns:
            dict: {"developer": "xxx", "currentHandler": "xxx"} 或 null 值
        """
        # 1. GET summary → 提取 processId, caseId, wfDiagram_v
        url = f"{self.base_url}/seeyon/collaboration/collaboration.do?method=summary"
        resp = self.session.get(url, params={
            'openFrom': 'listPending',
            'affairId': affair_id,
            'showTab': 'true',
        }, timeout=30)
        if resp.status_code != 200:
            print(f"ERROR: 获取 summary 失败, status={resp.status_code}", file=sys.stderr)
            return None

        summary_html = resp.text

        # 提取关键参数
        process_id = self._extract_var(summary_html, 'processId') or \
                     self._extract_hidden(summary_html, 'processId')
        case_id = self._extract_var(summary_html, 'caseId') or \
                  self._extract_hidden(summary_html, 'caseId')
        wf_diagram_v = self._extract_var(summary_html, 'wfDiagram_v')

        if not process_id or not case_id:
            print(f"WARN: summary 中缺少 processId 或 caseId", file=sys.stderr)
            return None

        # 2. GET 流程图（需要 wfDiagram_v 参数，否则返回 "Illegal access"）
        diagram_url = f"{self.base_url}/seeyon/workflow/designer.do?method=showDiagram"
        params = {
            'processId': process_id,
            'caseId': case_id,
        }
        if wf_diagram_v:
            params['v'] = wf_diagram_v

        resp2 = self.session.get(diagram_url, params=params, timeout=30)
        if resp2.status_code != 200:
            print(f"ERROR: 获取流程图失败, status={resp2.status_code}", file=sys.stderr)
            return None

        workflow_html = resp2.text
        if len(workflow_html) < 1000:
            print(f"WARN: 流程图响应过短 ({len(workflow_html)} bytes)，可能无权限", file=sys.stderr)
            return None

        # 3. 解析流程图中的 XML 数据，传入 affairNodeName 用于匹配当前节点
        return self._parse_workflow_data(workflow_html, affair_node_name)

    # ─── 辅助方法 ────────────────────────────────────────

    @staticmethod
    def _extract_var(html, var_name):
        """从 JS var 声明中提取变量值"""
        # var xxx = "value" 或 var xxx = 'value'
        m = re.search(rf'var\s+{var_name}\s*=\s*["\']([^"\']+)["\']', html)
        return m.group(1) if m else None

    @staticmethod
    def _extract_hidden(html, field_id):
        """从 hidden input 中提取值"""
        m = re.search(rf'<input[^>]*id="{field_id}"[^>]*value=[\'"]([^\'"]*)["\']', html)
        return m.group(1) if m else None

    def _parse_workflow_data(self, workflow_html, affair_node_name=None):
        """解析流程图 HTML 中的 processXml、caseLogXml、caseWorkitemLogXml

        从这三个 XML 中提取:
          - 开发人员：processXml 中 n 含"开发人员"的节点，caseWorkitemLogXml 中对应的人名
          - 当前处理人：优先用 affairNodeName 匹配节点，其次用 caseLogXml A=11
        """
        # 1. 提取并反转义 XML 字符串
        process_xml = self._extract_js_xml(workflow_html, 'initialize_processXml')
        case_log_xml = self._extract_js_xml(workflow_html, 'initialize_caseLogXml')
        workitem_log_xml = self._extract_js_xml(workflow_html, 'initialize_caseWorkitemLogXml')

        if not process_xml:
            print("WARN: 流程图中未找到 processXml", file=sys.stderr)
            return None

        # 2. 从 processXml 构建节点ID→节点名映射
        # <n i="节点ID" n="节点名" t="类型" ...>
        node_map = {}
        for m in re.finditer(r'<n\s+i="([^"]+)"\s+n="([^"]*)"', process_xml):
            node_map[m.group(1)] = m.group(2)

        # 也搜索 <s> 标签
        for m in re.finditer(r'<s\s+i="([^"]+)"\s+n="([^"]*)"', process_xml):
            node_map.setdefault(m.group(1), m.group(2))

        # 3. 从 caseWorkitemLogXml 构建节点ID→处理人列表映射
        #    同时提取每个 workitem 的 AS（affair state）用于判断活跃状态
        # <WL ... N="节点ID" PN="人名" AS="0,26" .../>
        # AS 字段含义: 0=初始, 21=已处理, 23=激活中, 26=暂存待办, 27=已提交, 5=已结束
        node_handlers = {}  # {节点ID: [人名列表]}
        workitem_states = {}  # {节点ID: [(人名, AS值列表)]}
        if workitem_log_xml:
            for m in re.finditer(r'<WL\s+([^/]+)/>', workitem_log_xml):
                attrs = m.group(1)
                attr_dict = {}
                for am in re.finditer(r'(\w+)="([^"]*)"', attrs):
                    attr_dict[am.group(1)] = am.group(2)
                node_id = attr_dict.get('N', '')
                person_name = attr_dict.get('PN', '')
                as_raw = attr_dict.get('AS', '')
                as_values = as_raw.split(',') if as_raw else []
                if node_id and person_name:
                    node_handlers.setdefault(node_id, []).append(person_name)
                    workitem_states.setdefault(node_id, []).append((person_name, as_values))

        # 4. 判断活跃节点：AS 包含 "26"（暂存待办）且不包含 "5"（已结束）或 "21"（已处理）
        #    同时保留 caseLogXml A=11 作为补充
        active_node_ids = set()
        # 4a. 从 caseWorkitemLogXml AS 字段判断（更准确）
        for node_id, items in workitem_states.items():
            for person_name, as_values in items:
                has_26 = '26' in as_values  # 暂存待办
                has_5 = '5' in as_values     # 已结束
                has_21 = '21' in as_values   # 已处理
                if has_26 and not has_5 and not has_21:
                    active_node_ids.add(node_id)
        # 4b. 从 caseLogXml A=11 补充（兼容旧数据）
        if case_log_xml:
            for m in re.finditer(r'<S\s+A="11"[^>]*N="([^"]*)"', case_log_xml):
                active_node_ids.add(m.group(1))

        # 5. 提取活跃 workitem 的处理人（真正的当前处理人）
        #    AS=26 且无 5/21 的 workitem 的人名
        active_handlers = {}  # {节点ID: [人名]}
        for node_id, items in workitem_states.items():
            for person_name, as_values in items:
                has_26 = '26' in as_values
                has_5 = '5' in as_values
                has_21 = '21' in as_values
                if has_26 and not has_5 and not has_21:
                    active_handlers.setdefault(node_id, []).append(person_name)

        all_nodes = []
        for node_id, node_name in node_map.items():
            handlers = node_handlers.get(node_id, [])
            is_active = node_id in active_node_ids
            # 活跃节点优先用 active_handlers（更精确）
            display_handlers = active_handlers.get(node_id, handlers) if is_active else handlers
            all_nodes.append({
                'id': node_id,
                'name': node_name,
                'handlers': display_handlers if display_handlers else [],
                'active': is_active,
            })

        # 6. 活跃节点列表
        active_nodes = [n for n in all_nodes if n['active']]

        # 7. 提取开发人员和当前处理人
        # 开发人员：节点名包含"开发人员"的节点上的处理人（去重）
        developer = None
        developer_names = set()
        for node_id, node_name in node_map.items():
            if '开发人员' in node_name:
                for name in node_handlers.get(node_id, []):
                    developer_names.add(name)
        if developer_names:
            developer = ', '.join(sorted(developer_names))

        # 当前处理人：优先从 active_handlers 取（基于 AS 状态判断，更准确）
        # 若存在开发人员，则从当前处理人中排除开发人员，只输出其他人；无其他人则输出开发人员
        current_handler = None
        if active_handlers:
            handler_names = []
            seen_h = set()
            for node_id, names in active_handlers.items():
                for name in names:
                    if name not in seen_h:
                        seen_h.add(name)
                        handler_names.append(name)
            if handler_names:
                if developer_names:
                    others = [n for n in handler_names if n not in developer_names]
                    current_handler = ', '.join(others) if others else ', '.join(handler_names)
                else:
                    current_handler = ', '.join(handler_names)

        # 降级：用 affairNodeName 匹配节点ID，再从 caseWorkitemLogXml 找人
        if not current_handler and affair_node_name:
            for node_id, node_name in node_map.items():
                if node_name and (affair_node_name.startswith(node_name) or
                                  node_name in affair_node_name or
                                  affair_node_name == node_name):
                    handlers = node_handlers.get(node_id, [])
                    if handlers:
                        current_handler = ', '.join(handlers)
                        break

        result = {
            'developer': developer,
            'currentHandler': current_handler,
            'allNodes': all_nodes,
            'activeNodes': active_nodes,
        }

        print(f"INFO: developer={developer}, currentHandler={current_handler}, "
              f"nodes={len(all_nodes)}, active={len(active_nodes)}", file=sys.stderr)
        return result

    @staticmethod
    def _extract_js_xml(html, var_name):
        """从 JS 变量声明中提取 XML 字符串并反转义"""
        m = re.search(rf"var\s+{var_name}\s*=\s*'(.*?)'\s*;", html, re.DOTALL)
        if not m:
            return None
        raw = m.group(1)
        # 反转义：A8 JS 中用 \" 表示引号，\/ 表示斜杠
        xml = raw.replace('\\"', '"').replace('\\/', '/')
        return xml

    # ─── 工单查询 ────────────────────────────────────────

    def query_workorder(self, ticket_no, pending_list=None):
        """查询单个工单的开发人员和当前处理人

        Args:
            ticket_no: 工单编号（如 KFXQ-CX-2026052600025）
            pending_list: 已获取的待办列表（可选，避免重复请求）

        Returns:
            dict: {"projectLiaison": "xxx", "currentHandler": "xxx"}
        """
        # 从待办列表中找到匹配的工单
        if pending_list is None:
            pending_list = self.get_pending_list()

        matched = None
        for item in pending_list:
            subject = item.get('subject', '')
            if ticket_no in subject:
                matched = item
                break

        if not matched:
            # 搜索更多页
            for page in range(2, 6):
                extra = self.get_pending_list(page=page)
                if not extra:
                    break
                for item in extra:
                    subject = item.get('subject', '')
                    if ticket_no in subject:
                        matched = item
                        break
                if matched:
                    break

        if not matched:
            print(f"WARN: 未找到工单 {ticket_no}", file=sys.stderr)
            return None

        affair_id = str(matched.get('affairId', ''))
        affair_node_name = matched.get('affairNodeName', '')
        print(f"INFO: 工单 {ticket_no} → affairId={affair_id}, affairNodeName={affair_node_name}", file=sys.stderr)

        return self.get_summary_and_workflow(affair_id, affair_node_name)


# ─── 主入口 ────────────────────────────────────────────

def main():
    """读取参数，登录 A8，批量查询工单"""
    if len(sys.argv) < 2:
        print("用法: python3 a8-batch-query-api.py '<JSON>' 或 --file params.json", file=sys.stderr)
        sys.exit(1)

    # 解析参数
    arg = sys.argv[1]
    if arg == '--file':
        if len(sys.argv) < 3:
            print("ERROR: --file 需要指定文件路径", file=sys.stderr)
            sys.exit(1)
        with open(sys.argv[2], 'r', encoding='utf-8') as f:
            params = json.load(f)
    else:
        params = json.loads(arg)

    login_url = params.get('loginUrl', '')
    ticketNos = params.get('ticketNos', [])
    username = params.get('username', '')
    password = params.get('password', '')

    if not login_url or not ticketNos:
        print("ERROR: 缺少 loginUrl 或 ticketNos", file=sys.stderr)
        sys.exit(1)

    # 从 loginUrl 推导 base_url
    # loginUrl: http://120.35.0.67:28101/seeyon/main.do?method=main
    # base_url: http://120.35.0.67:28101
    base_url = re.sub(r'/seeyon.*$', '', login_url.rstrip('/'))

    client = A8APIClient(base_url, login_url, username, password)

    # 登录
    if not client.login():
        for ticket_no in ticketNos:
            print(f"RESULT:{json.dumps({'ticketNo': ticket_no, 'developer': None, 'currentHandler': None})}")
        sys.exit(1)

    # 获取待办列表
    pending_list = client.get_pending_list()

    # 查询每个工单
    for ticket_no in ticketNos:
        result = client.query_workorder(ticket_no, pending_list)
        output = {
            'ticketNo': ticket_no,
            'developer': result.get('developer') if result else None,
            'currentHandler': result.get('currentHandler') if result else None,
            'allNodes': result.get('allNodes') if result else [],
            'activeNodes': result.get('activeNodes') if result else [],
        }
        print(f"RESULT:{json.dumps(output, ensure_ascii=False)}")


if __name__ == '__main__':
    main()