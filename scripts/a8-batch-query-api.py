#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工单批量查询脚本 - 纯 HTTP 版本（不依赖 Playwright）

通过 requests 库直接调用 A8 系统 HTTP 接口，替代 Playwright 浏览器自动化。

数据获取方式：
  - 登录：POST /seeyon/main.do?method=login
  - 待办列表：GET listPending，从 HTML 提取 $.ctx.fillmaps 内嵌 JSON
  - 工单详情：GET summary 页面，从 HTML 提取流程/处理人信息
  - 表单字段：尝试 cap4/businessTemplateController.do?method=formContent

用法:
  python3 a8-batch-query-api.py '{"ticketNos":["KFXQ-CX-xxx"],"loginUrl":"http://...","username":"xxx","password":"xxx"}'
  python3 a8-batch-query-api.py --file params.json

输出:
  RESULT:{"ticketNo":"xxx","info":{"developer":"张三","currentHandler":"李四","currentNode":"开发处理"}}
  RESULT:{"ticketNo":"yyy","info":null}
"""

import sys
import json
import re
import os
import time
from urllib.parse import urljoin, urlencode

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    from Crypto.Cipher import DES
except ImportError:
    # 降级：尝试 pycryptodome 的另一个导入路径
    try:
        from Cryptodome.Cipher import DES
    except ImportError:
        DES = None  # 将在 login 时提示


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

    @staticmethod
    def _des_encrypt_openssl(plaintext, passphrase):
        """CryptoJS.DES.encrypt 兼容的 DES-CBC 加密（OpenSSL 格式）

        CryptoJS 传入字符串 passphrase 时使用 EVP_BytesToKey 派生 key/iv:
          1. 生成随机 8 字节 salt
          2. D = MD5(passphrase + salt)
          3. key = D[:8], iv = D[8:16]
          4. DES-CBC 加密，PKCS7 填充
          5. 输出 Base64("Salted__" + salt + ciphertext)
        """
        import hashlib
        import base64
        import os

        passphrase_bytes = passphrase.encode('utf-8')
        salt = os.urandom(8)

        # EVP_BytesToKey (MD5, DES key=8, iv=8)
        d = hashlib.md5(passphrase_bytes + salt).digest()
        key = d[:8]
        iv = d[8:16]

        # PKCS7 padding
        plain_bytes = plaintext.encode('utf-8')
        pad_len = 8 - (len(plain_bytes) % 8)
        padded = plain_bytes + bytes([pad_len] * pad_len)

        cipher = DES.new(key, DES.MODE_CBC, iv)
        encrypted = cipher.encrypt(padded)

        # OpenSSL 格式: "Salted__" + salt + ciphertext
        result = b'Salted__' + salt + encrypted
        return base64.b64encode(result).decode('utf-8')

    @staticmethod
    def _extract_security_seed(html):
        """从登录页 HTML 中提取 _SecuritySeed 值（可为负数）"""
        m = re.search(r"_SecuritySeed\s*=\s*'(-?\d+)'", html)
        if m:
            return m.group(1)
        m = re.search(r'_SecuritySeed\s*=\s*"(-?\d+)"', html)
        if m:
            return m.group(1)
        return None

    def login(self):
        """登录 A8 系统，使用 DES 加密密码"""
        print(f"INFO: 正在登录 A8 ({self.login_url})...", file=sys.stderr)

        if DES is None:
            print("ERROR: pycryptodome 未安装，无法加密密码。Run: pip install pycryptodome", file=sys.stderr)
            return False

        # 1) GET 登录页，获取 JSESSIONID 和 _SecuritySeed
        try:
            resp = self.session.get(self.login_url, timeout=30)
        except requests.exceptions.ConnectionError as e:
            print(f"ERROR: 无法连接 A8 服务器: {e}", file=sys.stderr)
            return False
        except requests.exceptions.Timeout:
            print("ERROR: 连接 A8 服务器超时", file=sys.stderr)
            return False

        if resp.status_code != 200:
            print(f"ERROR: 访问登录页失败, status={resp.status_code}", file=sys.stderr)
            return False

        print(f"INFO: 登录页 GET 响应: status={resp.status_code}, url={resp.url}, len={len(resp.text)}", file=sys.stderr)

        # 处理 A8 的 meta refresh 跳板页
        # main.do?method=main 返回 <meta http-equiv="Refresh" content="0;url=...method=index">
        # requests 不跟随 meta refresh，需要手动解析
        if 'login_username' not in resp.text and len(resp.text) < 500:
            meta_match = re.search(r'<meta[^>]+http-equiv=["\']Refresh["\'][^>]+url=([^"\'>\s]+)', resp.text, re.IGNORECASE)
            if meta_match:
                refresh_url = meta_match.group(1)
                if not refresh_url.startswith('http'):
                    refresh_url = f"{self.base_url}{refresh_url}"
                print(f"INFO: 跟随 meta refresh → {refresh_url}", file=sys.stderr)
                try:
                    resp = self.session.get(refresh_url, timeout=30)
                except requests.exceptions.ConnectionError as e:
                    print(f"ERROR: 跟随 meta refresh 失败: {e}", file=sys.stderr)
                    return False
                print(f"INFO: 登录页最终响应: status={resp.status_code}, len={len(resp.text)}", file=sys.stderr)

        # 检查是否已经处于登录状态（GET 被重定向到主页）
        # A8 已登录时 → indexOpenWindow.jsp
        if 'indexOpenWindow' in resp.url or ('您好' in resp.text and 'login_username' not in resp.text):
            self.logged_in = True
            print("INFO: 已处于登录状态，无需重新登录", file=sys.stderr)
            return True

        # 2) 提取 _SecuritySeed
        seed = self._extract_security_seed(resp.text)
        if seed:
            print(f"INFO: 提取到 _SecuritySeed={seed}", file=sys.stderr)
        else:
            print("WARN: 未找到 _SecuritySeed，尝试明文登录", file=sys.stderr)

        # 3) DES 加密密码
        if seed:
            encrypted_pwd = self._des_encrypt_openssl(self.password, seed)
            print(f"INFO: 密码已 DES 加密", file=sys.stderr)
        else:
            encrypted_pwd = self.password

        # 4) POST 登录，模拟浏览器表单提交
        login_action = f"{self.base_url}/seeyon/main.do?method=login"
        data = {
            'login_username': self.username,
            'login_password': encrypted_pwd,
            'login_password1': '',  # 浏览器提交时此字段被 disabled
            'login_validatePwdStrength': '4',
            'login.timezone': 'Asia/Shanghai',
            'fontSize': '12',
            'screenWidth': '1920',
            'screenHeight': '1080',
        }
        try:
            resp = self.session.post(login_action, data=data, timeout=30, allow_redirects=True)
        except requests.exceptions.ConnectionError as e:
            print(f"ERROR: 登录请求连接失败: {e}", file=sys.stderr)
            return False

        text = resp.text

        # 5) 判断登录结果
        # A8 登录成功：POST 返回 "ok" 前缀，或 302 到主页
        # A8 登录失败：重定向回登录页 (main.do?1=1)
        if 'login_username' in text and 'login_password1' in text:
            print(f"ERROR: 登录失败，仍在登录页面 (url={resp.url})", file=sys.stderr)
            print(f"DEBUG: 响应前200字符: {text[:200]}", file=sys.stderr)
            return False

        # 登录成功判断：URL 包含 indexOpenWindow 或页面含登录后特征
        if 'indexOpenWindow' in str(resp.url) or '您好' in text or 'mainFrame' in text or '系统加载中' in text:
            self.logged_in = True
            print(f"INFO: 登录成功 (url={resp.url})", file=sys.stderr)
            return True

        # POST 直接返回 "ok" 的情况（doAjaxLogin 模式）
        if text.strip().startswith('ok'):
            self.logged_in = True
            print("INFO: 登录成功（返回 ok）", file=sys.stderr)
            return True

        # 降级：不在登录页就认为成功
        if resp.status_code == 200 and 'login_username' not in text:
            self.logged_in = True
            print(f"INFO: 登录成功（降级判断, url={resp.url})", file=sys.stderr)
            return True

        print(f"WARN: 登录状态不确定, status={resp.status_code}, url={resp.url}", file=sys.stderr)
        print(f"DEBUG: 响应前300字符: {text[:300]}", file=sys.stderr)
        return False

    def get_pending_list(self, page=1):
        """获取待办列表，从 HTML 中提取 fillmaps JSON 数据

        Returns:
            list[dict]: 每项含 affairId, subject, formAppId, formRecordid,
                        processId, caseId, workitemId, activityId, nodeName 等
        """
        url = f"{self.base_url}/seeyon/collaboration/collaboration.do?method=listPending"
        params = {
            'page': page,
            'rows': 100,  # 每页条数
        }
        resp = self.session.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"ERROR: 获取待办列表失败, status={resp.status_code}", file=sys.stderr)
            return []

        html = resp.text
        return self._extract_fillmaps(html)

    def _extract_fillmaps(self, html):
        """从 listPending HTML 中提取 $.ctx.fillmaps JSON 数据

        页面中包含类似:
          $.ctx.fillmaps = {"data":{"listPending":{"data":[...]}}};
        """
        # 匹配 $.ctx.fillmaps = {...};
        pattern = r'\$\.ctx\.fillmaps\s*=\s*(\{.*?\})\s*;'
        match = re.search(pattern, html, re.DOTALL)
        if not match:
            print("WARN: 未在 HTML 中找到 fillmaps 数据", file=sys.stderr)
            return []

        try:
            fillmaps = json.loads(match.group(1))
        except json.JSONDecodeError as e:
            print(f"WARN: fillmaps JSON 解析失败: {e}", file=sys.stderr)
            return []

        # 提取 listPending.data 数组
        # 实际结构: {"listPending": {"data": [...], "page": ..., ...}}
        try:
            data_list = fillmaps['listPending']['data']
        except (KeyError, TypeError):
            # 兼容可能的外层 data 包裹
            try:
                data_list = fillmaps['data']['listPending']['data']
            except (KeyError, TypeError):
                print(f"WARN: fillmaps 结构不符合预期, top-level keys: {list(fillmaps.keys())}", file=sys.stderr)
                return []

        print(f"INFO: 从 fillmaps 提取到 {len(data_list)} 条待办", file=sys.stderr)
        return data_list

    def get_workorder_detail(self, affair_id):
        """获取工单详情页面 HTML

        Args:
            affair_id: 事项 ID

        Returns:
            str: 详情页 HTML
        """
        url = f"{self.base_url}/seeyon/collaboration/collaboration.do?method=summary"
        params = {
            'openFrom': 'listPending',
            'affairId': affair_id,
            'showTab': 'true',
        }
        resp = self.session.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"ERROR: 获取工单详情失败, status={resp.status_code}", file=sys.stderr)
            return None
        return resp.text

    def get_workflow_diagram(self, summary_html):
        """获取流程视图 iframe 的 HTML 内容

        Playwright 版本通过点击"流程"tab 加载 workflow iframe，
        HTTP 版本直接请求流程图 URL。

        流程图 URL 格式: /seeyon/workflow/designer.do?method=showDiagram&...
        需要从 summary HTML 中提取相关参数。

        Args:
            summary_html: summary 页面 HTML

        Returns:
            str|None: 流程图 HTML
        """
        # 从 summary HTML 中提取流程图 iframe 的 URL
        # 格式: <iframe src="/seeyon/workflow/designer.do?method=showDiagram&processId=xxx&caseId=xxx&...">
        workflow_pattern = re.compile(
            r'src="([^"]*workflow/designer\.do\?[^"]*showDiagram[^"]*)"',
            re.IGNORECASE
        )
        match = workflow_pattern.search(summary_html)
        if not match:
            # 降级：尝试从 JS 变量中拼凑流程图 URL
            # summary 页面中可能包含 processId, caseId 等参数
            process_id = None
            case_id = None
            for var_pattern, var_name in [
                (r'var\s+processId\s*=\s*["\']([^"\']+)["\']', 'processId'),
                (r'["\']processId["\']\s*:\s*["\']([^"\']+)["\']', 'processId'),
                (r'var\s+caseId\s*=\s*["\']([^"\']+)["\']', 'caseId'),
                (r'["\']caseId["\']\s*:s*["\']([^"\']+)["\']', 'caseId'),
            ]:
                m = re.search(var_pattern, summary_html)
                if m:
                    if var_name == 'processId':
                        process_id = m.group(1)
                    elif var_name == 'caseId':
                        case_id = m.group(1)

            if process_id and case_id:
                url = f"{self.base_url}/seeyon/workflow/designer.do?method=showDiagram"
                params = {
                    'processId': process_id,
                    'caseId': case_id,
                }
                try:
                    resp = self.session.get(url, params=params, timeout=30)
                    if resp.status_code == 200:
                        return resp.text
                except Exception as e:
                    print(f"WARN: 获取流程图异常: {e}", file=sys.stderr)
            return None

        workflow_url = match.group(1)
        if not workflow_url.startswith('http'):
            workflow_url = f"{self.base_url}{workflow_url}" if workflow_url.startswith('/') else f"{self.base_url}/{workflow_url}"

        try:
            resp = self.session.get(workflow_url, timeout=30)
            if resp.status_code == 200:
                return resp.text
        except Exception as e:
            print(f"WARN: 获取流程图异常: {e}", file=sys.stderr)
        return None

    def extract_handler_from_workflow_html(self, workflow_html):
        """从流程图 HTML/SVG 中提取当前节点和处理人（模拟 Playwright 版逻辑）

        Playwright 版本从 SVG 流程图中:
        1. 找 <use href="#icon_..._current"> 标识当前节点
        2. 从当前节点所在 <g> 元素的 <text> 提取节点名
        3. 从流程文本中，当前节点后面紧跟的人名即为处理人

        HTTP 版本解析流程图 HTML 中的 SVG，实现相同逻辑。

        Args:
            workflow_html: 流程图页面 HTML

        Returns:
            dict|None: {currentNode, currentHandler}
        """
        result = {}
        current_node = ''

        # 方法1: 从 SVG 中找当前节点（<use> 元素 href 含 "current"）
        # 找所有 <use> 标签，检查 href/xlink:href 是否含 "current"
        use_pattern = re.compile(
            r'<use[^>]*(?:xlink:href|href)=["\']([^"\']*current[^"\']*)["\'][^>]*>',
            re.IGNORECASE
        )
        for use_match in use_pattern.finditer(workflow_html):
            # 找包含此 <use> 的 <g> 元素，提取 <text> 内容
            use_pos = use_match.start()
            # 向前找最近的 <g> 开始标签
            g_start = workflow_html.rfind('<g', 0, use_pos)
            if g_start == -1:
                continue
            # 向后找对应的 </g>
            g_end = workflow_html.find('</g>', use_pos)
            if g_end == -1:
                g_end = len(workflow_html)
            g_content = workflow_html[g_start:g_end + 4]

            # 提取 <text> 内容
            text_pattern = re.compile(r'<text[^>]*>([^<]*)</text>', re.DOTALL)
            for text_match in text_pattern.finditer(g_content):
                text = text_match.group(1).strip()
                if not text:
                    continue
                # 去掉 SVG 重复文本（A8 SVG text 会有两份，如"开发人员开发中开发人员开发中"）
                half = text[:len(text) // 2 + len(text) % 2]
                if text == half + half:
                    text = half
                # 跳过 [审批-xxx] 类的组织标签
                if re.match(r'^\[审批', text):
                    continue
                if text:
                    current_node = text
            if current_node:
                break

        if current_node:
            result['currentNode'] = current_node

        # 方法2: 从流程文本中提取节点和人名列表，找当前节点后面的人名
        # Playwright 版本从 document.body.innerText 获取文本行
        # HTTP 版本从 HTML 中提取文本内容
        body_text = re.sub(r'<[^>]+>', '\n', workflow_html)  # 去掉 HTML 标签
        body_text = re.sub(r'&[a-zA-Z]+;', ' ', body_text)   # 去掉 HTML 实体
        lines = [l.strip() for l in body_text.split('\n') if l.strip()]
        # 过滤无关行
        nodes = []
        for line in lines:
            if line == '流程预测' or re.match(r'^\[审批', line) or re.match(r'^\d+%$', line):
                continue
            nodes.append(line)

        # 找当前节点在列表中的位置，向后找人名
        current_handler = ''
        if current_node:
            try:
                idx = nodes.index(current_node)
            except ValueError:
                # 模糊匹配：当前节点名可能是列表中某项的子串
                idx = -1
                for i, n in enumerate(nodes):
                    if current_node in n or n in current_node:
                        idx = i
                        break
            if idx >= 0:
                # 人名特征: 2-4个中文字符，或含括号(如"黄圣茂(博思软件)")
                # 不是节点名(不含: 处理、验证、确认、评估、发起、开发、支持、人员)
                for i in range(idx + 1, len(nodes)):
                    name = nodes[i]
                    if not re.search(r'处理|验证|确认|评估|发起|开发|支持|人员|一线|节点', name):
                        current_handler = name
                        break

        # 降级: 如果没找到当前节点，取文本中第一个人名
        if not current_handler and not current_node and nodes:
            for i, n in enumerate(nodes):
                if not re.search(r'处理|验证|确认|评估|发起|开发|支持|人员|一线|节点', n):
                    current_handler = n
                    break

        if current_handler:
            result['currentHandler'] = current_handler

        return result if result else None

    def get_form_content(self, form_app_id, form_record_id, right_id, module_id):
        """通过 cap4 接口获取表单内容（含开发人员等字段）

        Args:
            form_app_id: 表单应用 ID
            form_record_id: 表单记录 ID
            right_id: 权限 ID
            module_id: 模块 ID

        Returns:
            dict|None: 表单内容 JSON，失败返回 None
        """
        url = f"{self.base_url}/seeyon/cap4/businessTemplateController.do?method=formContent"
        params = {
            'formAppId': form_app_id,
            'formRecordid': form_record_id,
            'rightId': right_id,
            'moduleId': module_id,
            'moduleType': '20',
        }
        try:
            resp = self.session.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                try:
                    return resp.json()
                except json.JSONDecodeError:
                    # 可能返回 HTML，不是 JSON
                    pass
        except Exception as e:
            print(f"WARN: 获取表单内容异常: {e}", file=sys.stderr)
        return None

    def extract_handler_from_summary(self, html):
        """从 summary 页面 HTML 提取当前处理人和当前节点

        summary 页面中包含意见区 HTML，格式如：
          <span>姓名</span> <span class="padding_l_5 color_black" title="部门">部门</span>
          <span class="margin_l_20 font_bold">暂存待办</span> <span>日期</span>

        也可能包含流程节点信息在 JS 变量中。

        Returns:
            dict|None: {currentHandler, currentNode, department}
        """
        result = {}

        # 方法1: 从意见区 HTML 提取（暂存待办/办理中/已办 状态标记）
        # 匹配: 姓名 + 部门 + 状态(暂存待办/移交/回退/办理中) + 日期
        handler_pattern = re.compile(
            r'>([^<]{2,10})</span>\s*'
            r'<span[^>]*class="[^"]*padding_l_5[^"]*"[^>]*title="([^"]*)"[^>]*>[^<]*</span>\s*'
            r'<span[^>]*class="[^"]*(?:font_bold|margin_l_20)[^"]*"[^>]*>'
            r'(暂存待办|移交|回退|办理中|已办)',
            re.DOTALL
        )
        matches = handler_pattern.findall(html)
        if matches:
            # 取最后一个匹配（最新的处理人）
            name, dept, status = matches[-1]
            result['currentHandler'] = name.strip()
            result['currentNode'] = status.strip()
            result['department'] = dept.strip()

        # 方法2: 从 JS 变量提取 affair/workitem 信息
        # 页面中可能有 window.affair 或类似的 JS 对象
        affair_pattern = re.compile(r'var\s+affair\s*=\s*(\{[^;]*\})\s*;')
        affair_match = affair_pattern.search(html)
        if affair_match:
            try:
                affair = json.loads(affair_match.group(1))
                if 'nodeName' in affair and 'currentNode' not in result:
                    result['currentNode'] = affair['nodeName']
            except json.JSONDecodeError:
                pass

        # 方法3: 从 var nodeName JS 变量提取当前节点名
        # summary 页面中包含: var nodeName = "开发人员填写计划完成时间";
        if 'currentNode' not in result:
            node_js_pattern = re.compile(r'var\s+nodeName\s*=\s*["\']([^"\']+)["\']\s*;')
            node_js_match = node_js_pattern.search(html)
            if node_js_match:
                result['currentNode'] = node_js_match.group(1).strip()

        # 方法4: 从页面文本中提取当前节点
        if 'currentNode' not in result:
            node_pattern = re.compile(r'当前(?:节点|环节)[：:]\s*([^\n<]+)')
            node_match = node_pattern.search(html)
            if node_match:
                result['currentNode'] = node_match.group(1).strip()

        return result if result else None

    def extract_developer_from_form(self, form_data):
        """从表单数据中提取开发人员字段

        Args:
            form_data: 表单内容 JSON（来自 get_form_content）

        Returns:
            str|None: 开发人员姓名
        """
        if not form_data:
            return None

        # 尝试在表单数据中查找 "开发人员" 字段
        # cap4 表单数据结构可能是嵌套的
        def find_developer(obj, depth=0):
            if depth > 10:
                return None
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if '开发人员' in str(key):
                        if isinstance(value, str) and re.search(r'[一-龥]{2,}', value):
                            return value.strip()
                        if isinstance(value, dict):
                            # 可能在 value 或 display/text 子字段中
                            for sub_key in ['value', 'display', 'text', 'name']:
                                if sub_key in value:
                                    v = str(value[sub_key])
                                    if re.search(r'[一-龥]{2,}', v):
                                        return v.strip()
                        if isinstance(value, list):
                            names = []
                            for item in value:
                                if isinstance(item, str) and re.search(r'[一-龥]{2,}', item):
                                    names.append(item.strip())
                                elif isinstance(item, dict):
                                    for sub_key in ['value', 'display', 'text', 'name']:
                                        if sub_key in item:
                                            v = str(item[sub_key])
                                            if re.search(r'[一-龥]{2,}', v):
                                                names.append(v.strip())
                            if names:
                                return '、'.join(names)
                    result = find_developer(value, depth + 1)
                    if result:
                        return result
            elif isinstance(obj, list):
                for item in obj:
                    result = find_developer(item, depth + 1)
                    if result:
                        return result
            return None

        return find_developer(form_data)

    def parse_subject(self, subject):
        """从 subject 字符串中解析工单号、项目名等信息

        subject 格式示例:
          "KFXQ-CX-20260528-001 关于xxx的需求 陈政伟"
          "QXWT-CX-20260520-003 关于xxx的问题 张三(博思软件)"

        Returns:
            dict: {ticketNo, projectName, supportPerson} 等可选字段
        """
        result = {}

        # 提取工单号 (KFXQ-CX-xxx 或 QXWT-CX-xxx)
        ticket_match = re.search(r'((?:KFXQ|QXWT)-CX-\d+(?:-\d+)?)', subject)
        if ticket_match:
            result['ticketNo'] = ticket_match.group(1)

        # 提取支持人员（subject 末尾的人名，可能带括号括住公司名）
        # 格式: " 姓名" 或 " 姓名(公司)" 在 subject 末尾
        person_match = re.search(r'\s+([一-龥]{2,4}(?:\([^)]+\))?)\s*$', subject)
        if person_match:
            result['supportPerson'] = person_match.group(1)

        return result

    def query_workorder(self, ticket_no, pending_data=None):
        """查询单个工单的完整信息

        与 Playwright 版一致的提取顺序:
        1. 从 fillmaps 获取基本信息
        2. 获取 summary 页面
        3. 从流程图提取当前节点和处理人（优先，与 Playwright 的流程视图一致）
        4. 降级到 summary 意见区提取
        5. 通过 cap4 表单 API 或 summary HTML 提取开发人员

        Args:
            ticket_no: 工单编号
            pending_data: 可选，该工单在 fillmaps 中的数据（避免重复获取列表）

        Returns:
            dict|None: 工单信息 {developer, currentHandler, currentNode, ...}
        """
        info = {}

        # 如果没有传入 pending_data，从列表中查找
        if not pending_data:
            pending_data = self._find_in_pending(ticket_no)

        if not pending_data:
            print(f"WARN: 工单 {ticket_no} 在待办列表中未找到", file=sys.stderr)
            return None

        # 从 fillmaps 数据中提取基本信息
        if pending_data.get('affairNodeName'):
            info['affairNodeName'] = pending_data['affairNodeName']
        if pending_data.get('startMemberName'):
            info['startMember'] = pending_data['startMemberName']
        if pending_data.get('preApproverName'):
            info['preApprover'] = pending_data['preApproverName']

        # 获取工单详情页
        affair_id = pending_data.get('affairId')
        summary_html = None
        if affair_id:
            summary_html = self.get_workorder_detail(affair_id)

        if summary_html:
            # 优先从流程图提取当前节点和处理人（与 Playwright 版一致）
            workflow_html = self.get_workflow_diagram(summary_html)
            if workflow_html:
                workflow_info = self.extract_handler_from_workflow_html(workflow_html)
                if workflow_info:
                    if workflow_info.get('currentNode'):
                        info['currentNode'] = workflow_info['currentNode']
                    if workflow_info.get('currentHandler'):
                        info['currentHandler'] = workflow_info['currentHandler']

            # 降级: 从 summary 意见区提取（Playwright 版的降级方案）
            if 'currentHandler' not in info:
                handler_info = self.extract_handler_from_summary(summary_html)
                if handler_info:
                    if handler_info.get('currentHandler'):
                        info['currentHandler'] = handler_info['currentHandler']
                    if handler_info.get('currentNode') and 'currentNode' not in info:
                        info['currentNode'] = handler_info['currentNode']
                    if handler_info.get('department'):
                        info['department'] = handler_info['department']

            # 降级: fillmaps 中的 nodeName 作为最后补充
            if 'currentNode' not in info and pending_data.get('nodeName'):
                info['currentNode'] = pending_data['nodeName']

            # 提取开发人员（与 Playwright 版一致，优先从表单 API 提取）
            developer = None

            # 方法1: 通过 cap4 表单 API 提取（最可靠，与 Playwright 的 form iframe 一致）
            form_ids = self._extract_form_ids(summary_html)
            if form_ids:
                form_data = self.get_form_content(
                    form_ids.get('formAppId'),
                    form_ids.get('formRecordid'),
                    form_ids.get('rightId'),
                    form_ids.get('moduleId'),
                )
                if form_data:
                    developer = self.extract_developer_from_form(form_data)

            # 方法2: 从 summary HTML 直接提取开发人员（降级）
            if not developer:
                developer = self._extract_developer_from_html(summary_html)

            if developer:
                info['developer'] = developer

        # 从 subject 解析补充信息
        subject = pending_data.get('subject', '')
        if subject:
            parsed = self.parse_subject(subject)
            if 'supportPerson' in parsed and 'developer' not in info:
                # 降级：用 subject 中的支持人员作为开发人员
                info['developer'] = parsed['supportPerson']

        return info if info else None

    def _find_in_pending(self, ticket_no):
        """在待办列表中查找包含指定工单号的条目"""
        all_data = self.get_pending_list()
        for item in all_data:
            subject = item.get('subject', '')
            if ticket_no in subject:
                return item
        return None

    def _extract_form_ids(self, html):
        """从 summary HTML 中提取表单相关 ID

        summary 页面中包含表单 iframe URL，格式如：
          /seeyon/common/cap4/template/display/pc/form/dist/index.html?
            V=...&type=edit&rightId=xxx&moduleId=xxx&moduleType=20
            &formAppId=xxx&formRecordid=xxx

        Returns:
            dict: {rightId, moduleId, formAppId, formRecordid}
        """
        result = {}

        # 从 iframe src 中提取
        iframe_pattern = re.compile(
            r'src="([^"]*form/dist/index\.html\?[^"]*)"',
            re.IGNORECASE
        )
        iframe_match = iframe_pattern.search(html)
        if iframe_match:
            iframe_url = iframe_match.group(1)
            for param_name in ['rightId', 'moduleId', 'formAppId', 'formRecordid']:
                param_match = re.search(
                    rf'{param_name}=([^&"]+)', iframe_url
                )
                if param_match:
                    result[param_name] = param_match.group(1)

        # 降级：从 JS 变量中提取
        if not result:
            # 查找 window.formAppId / window.formRecordid 等
            for param_name in ['formAppId', 'formRecordid', 'moduleId', 'rightId']:
                js_pattern = re.compile(
                    rf'(?:var\s+{param_name}\s*=\s*|["\']{param_name}["\']\s*:\s*)["\']?(\d+)["\']?'
                )
                js_match = js_pattern.search(html)
                if js_match and param_name not in result:
                    result[param_name] = js_match.group(1)

        return result if result else None

    def _extract_developer_from_html(self, html):
        """从 summary HTML 中直接提取开发人员（降级方案）

        表单内容可能以 HTML 形式嵌入在 summary 页面中，
        开发人员字段格式：
          <label>开发人员</label>...<span>姓名</span>
          或 "开发人员" 后跟中文人名

        注意：A8 的流程节点名可能包含"开发人员"（如"开发人员填写计划完成时间"），
        需要排除 var nodeName = "开发人员..." 这种误匹配。

        Returns:
            str|None: 开发人员姓名
        """
        # 方法1: 查找 "开发人员" 标签后的中文人名
        # 格式: 开发人员\n姓名  或  开发人员</label>...姓名
        # 排除: var nodeName = "开发人员..." 和 title="--开发需求-..."
        dev_pattern = re.compile(
            r'开发人员[\s\n]*(?:</?\w+[^>]*>[\s\n]*)*([一-龥]{2,4}(?:[、,，][一-龥]{2,4})*)'
        )
        for match in dev_pattern.finditer(html):
            candidate = match.group(1)
            # 排除选项值和节点名中的误匹配
            if re.match(r'^(补丁包|确定修改|暂不修改|其他|填写计划|填写计划完成时间)$', candidate):
                continue
            # 检查上下文：排除 var nodeName = "开发人员..." 的情况
            start = max(0, match.start() - 30)
            prefix = html[start:match.start()]
            if 'nodeName' in prefix or 'var ' in prefix:
                continue
            return candidate

        # 方法2: 查找 input 标签，name/title 含 "开发人员"
        input_pattern = re.compile(
            r'<input[^>]*(?:name|title|id)=["\'][^"\']*开发人员[^"\']*["\'][^>]*value=["\']([^"\']+)["\']',
            re.IGNORECASE
        )
        match = input_pattern.search(html)
        if match:
            val = match.group(1).strip()
            if re.search(r'[一-龥]{2,}', val):
                return val

        return None


def main():
    if len(sys.argv) < 2:
        print("ERROR: 缺少参数", file=sys.stderr)
        print("用法: python3 a8-batch-query-api.py '{\"ticketNos\":[...],\"baseUrl\":\"...\",\"loginUrl\":\"...\",\"username\":\"...\",\"password\":\"...\"}'", file=sys.stderr)
        print("  或: python3 a8-batch-query-api.py --file params.json", file=sys.stderr)
        sys.exit(1)

    # 支持 --file 方式传入 JSON 参数（Windows 兼容）
    if sys.argv[1] == "--file" and len(sys.argv) >= 3:
        try:
            with open(sys.argv[2], 'r', encoding='utf-8') as f:
                args = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            print(f"ERROR: 参数文件解析失败: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        try:
            args = json.loads(sys.argv[1])
        except json.JSONDecodeError as e:
            print(f"ERROR: 参数 JSON 解析失败: {e}", file=sys.stderr)
            sys.exit(1)

    ticket_nos = args.get("ticketNos", [])
    base_url = args.get("baseUrl", "http://120.35.0.67:28101")
    login_url = args.get("loginUrl", "http://120.35.0.67:28101/seeyon/main.do?method=main")
    username = args.get("username", "")
    password = args.get("password", "")

    if not ticket_nos:
        print("WARN: 无工单号需要查询", file=sys.stderr)
        sys.exit(0)

    if not username or not password:
        print("ERROR: 缺少 username 或 password", file=sys.stderr)
        sys.exit(1)

    print(f"INFO: 开始批量查询 {len(ticket_nos)} 个工单（纯 HTTP 模式）", file=sys.stderr)

    client = A8APIClient(base_url, login_url, username, password)

    # 登录
    if not client.login():
        print("ERROR: 登录失败，终止查询", file=sys.stderr)
        # 输出所有工单的空结果
        for ticket_no in ticket_nos:
            result = {"ticketNo": ticket_no, "info": None}
            print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")
        sys.exit(1)

    # 预加载待办列表（一次获取，避免每个工单都请求一次）
    print("INFO: 加载待办列表...", file=sys.stderr)
    all_pending = client.get_pending_list()

    # 建立工单号 -> pending_data 的索引
    pending_index = {}
    for item in all_pending:
        subject = item.get('subject', '')
        for ticket_no in ticket_nos:
            if ticket_no in subject:
                pending_index[ticket_no] = item
                break

    print(f"INFO: 在待办列表中匹配到 {len(pending_index)}/{len(ticket_nos)} 个工单", file=sys.stderr)

    # 逐个查询工单
    for i, ticket_no in enumerate(ticket_nos):
        print(f"INFO: [{i+1}/{len(ticket_nos)}] 查询工单 {ticket_no}", file=sys.stderr)

        try:
            pending_data = pending_index.get(ticket_no)
            info = client.query_workorder(ticket_no, pending_data)
            result = {"ticketNo": ticket_no, "info": info}
            print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")
        except Exception as e:
            print(f"WARN: 查询工单 {ticket_no} 出错: {e}", file=sys.stderr)
            result = {"ticketNo": ticket_no, "info": None}
            print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")

    print("INFO: 完成", file=sys.stderr)


if __name__ == "__main__":
    main()
