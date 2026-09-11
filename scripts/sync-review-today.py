#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键同步「无纸化代码复核表」暂存表
=================================
流程：下载本地源表 → 过滤（周兴杰/开发完成/开发完成日期=今天）→ 反查 Codeup MR
      → 去重 → 写入暂存表 → 回读校验 → 输出汇总

用法：
    python3.12 sync-review-today.py                 # 同步今天
    python3.12 sync-review-today.py --date 2026-09-10
    python3.12 sync-review-today.py --dry-run       # 只跑不写

依赖：python3.12（openpyxl）、mcporter、git+CODEUP_PAT
文档：tencent-docs skill → references/workorder-sync.md
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------- 配置
PERF = '/home/ubuntu/performance-tool'
SRC_XLSX = f'{PERF}/data/work-record.xlsx'
ENV_FILE = f'{PERF}/.env'

TARGET_FILE_ID = 'AfuiBEsUBpQE'          # 周兴杰无纸化复核表(暂存)
TARGET_SHEET_ID = 'BB08J2'
OFFICIAL_FILE_ID = 'DTHVRRGJtd0ZWVEtj'   # 官方无纸化代码复核表
OFFICIAL_SHEET_ID = 'BB08J2'

DEV = '周兴杰'
CATEGORIES = ('需求', '程序缺陷')
PRODUCTS = ('pcx', 'gwwy-uniapp')
DONE_STATE = '开发完成'

# 产品标识 → 候选仓库路径（按序尝试，取「提交实际存在」的那个）
REPO_CANDIDATES = {
    'pcx': ['fruits/orange/product/pcx', 'fruits/pitaya/product/pcx/pty-pcx'],
    'gwwy-uniapp': ['fruits/lemon/gwwy-uniapp'],
}
CACHE = os.path.expanduser('~/.cache/codeup')
GIT_BASE = 'https://codeup.aliyun.com'

# 源表列索引（0-based）
C_REG, C_REGDT, C_CAT, C_CONTENT, C_STATE = 0, 1, 2, 3, 5
C_DONEDT, C_PROJ, C_PROD, C_NO, C_INFO, C_A8 = 8, 9, 11, 12, 14, 16

# 目标表列索引（23 列，见 workorder-sync.md §8.1）
T_DEV, T_MONTHNO, T_A8, T_FEBE, T_PROJ, T_DESC, T_URL = 0, 1, 2, 3, 6, 7, 8
T_INIT, T_FINAL, T_REVIEW, T_MERGE, T_FEBE_FLAG = 9, 10, 11, 12, 13


# ---------------------------------------------------------------- 工具
def sh(cmd, timeout=600):
    p = subprocess.run(['bash', '-lc', cmd], capture_output=True, text=True, timeout=timeout)
    return (p.stdout or '') + (p.stderr or '')


def log(*a):
    print(*a, flush=True)


def codeup_pat():
    with open(ENV_FILE, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'\s*(?:export\s+)?CODEUP_PAT\s*=\s*(.+?)\s*$', line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    raise SystemExit('ERROR: 未在 %s 找到 CODEUP_PAT' % ENV_FILE)


def auth_url(repo_path, pat):
    return f'https://oauth2:{pat}@codeup.aliyun.com/{repo_path}.git'


def mcporter(tool, args, retries=4, timeout=180):
    """调 mcporter；manage.*/sheet.* 用空格语法；自动重试瞬时 405/SSE 错误"""
    payload = json.dumps(args, ensure_ascii=False)
    with open('/tmp/_mc_args.json', 'w', encoding='utf-8') as f:
        f.write(payload)
    out = ''
    for _ in range(retries):
        out = sh(f'mcporter call "tencent-docs" {tool} --args "$(cat /tmp/_mc_args.json)"', timeout=timeout)
        if 'SSE error' not in out and '405' not in out:
            try:
                return json.loads(out)
            except Exception:
                return {'_raw': out}
    return {'_raw': out, '_error': 'mcporter retries exhausted'}


def parse_cn_date(v):
    """源表日期是中文文本（2026年9月11日）→ date"""
    if v is None:
        return None
    m = re.match(r'(\d{4})\D+(\d{1,2})\D+(\d{1,2})', str(v).strip())
    return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


# ---------------------------------------------------------------- 步骤 1
def download_source():
    log('[1/6] 下载源表 …')
    for attempt in range(1, 4):
        out = sh(f'cd {PERF} && npm run download-work-record', timeout=600)
        if os.path.exists(SRC_XLSX):
            age = datetime.datetime.now().timestamp() - os.path.getmtime(SRC_XLSX)
            nbytes = os.path.getsize(SRC_XLSX)
            if age < 3600 and nbytes > 100_000:
                log(f'      ✅ {SRC_XLSX}  ({nbytes/1024/1024:.1f} MB, {age/60:.1f} 分钟前)')
                return SRC_XLSX
        log(f'      第 {attempt} 次失败（403/Cookie 抖动），重试 …')
    raise SystemExit('ERROR: 源表下载失败（重试 3 次）。')


# ---------------------------------------------------------------- 步骤 2
def filter_rows(path, day):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb['工作记录']
    rows = [r for r in list(ws.iter_rows(values_only=True))[1:]
            if any(v is not None and str(v).strip() != '' for v in r)]
    total_today = sum(1 for r in rows if parse_cn_date(r[C_DONEDT]) == day)
    keep = [r for r in rows
            if r[C_REG] == DEV
            and parse_cn_date(r[C_DONEDT]) == day
            and r[C_CAT] in CATEGORIES
            and r[C_PROD] in PRODUCTS
            and r[C_STATE] == DONE_STATE]
    log(f'[2/6] 过滤：源表 {len(rows)} 行；「开发完成日期={day}」全表 {total_today} 条；'
        f'→ 写入口径（{DEV}）{len(keep)} 条')
    return keep, total_today


# ---------------------------------------------------------------- 步骤 3
def ensure_repo(repo_path, pat):
    os.makedirs(CACHE, exist_ok=True)
    slug = repo_path.replace('/', '_')
    d = os.path.join(CACHE, slug)
    url = auth_url(repo_path, pat)
    if not os.path.isdir(os.path.join(d, '.git')):
        log(f'      克隆 {repo_path} …')
        out = sh(f'git clone --filter=blob:none --no-checkout "{url}" "{d}"', timeout=900)
        if not os.path.isdir(os.path.join(d, '.git')):
            return None, out
    # ⚠️ 必须同时拉 refs/changes/*/head：开发分支被删除后，只有 change 引用还留着原始提交；
    #    不拉的话 `git log --all` 找不到它，会退而选中已合入的副本（且可能没有 MR）
    sh(f'git -C "{d}" fetch -q --filter=blob:none origin '
       f'"+refs/heads/*:refs/remotes/origin/*" '
       f'"+refs/changes/*/head:refs/remotes/changes/*" --prune', timeout=900)
    return d, ''


def _is_junk(subject):
    """变基/拣选失败的提交，message 会被污染（含 'could not apply' / 'left in tree' 等）"""
    return bool(re.search(r'could not apply|left in tree|CONFLICT|Version [0-9a-f]{8,}', subject))


_BRANCH_CACHE = {}


def branches_containing(d, sha):
    """返回包含该提交的所有远端引用（origin 分支 + changes/{localId}）"""
    if not sha:
        return []
    if sha not in _BRANCH_CACHE:
        out = sh(f'git -C "{d}" for-each-ref --contains={sha} '
                 f'--format="%(refname)" refs/remotes/', timeout=240)
        _BRANCH_CACHE[sha] = [x for x in out.split() if x.startswith('refs/remotes/')]
    return _BRANCH_CACHE[sha]


def split_refs(refs):
    """拆成 (origin 分支名列表, change localId 列表)"""
    branches, changes = [], []
    for r in refs:
        if r.startswith('refs/remotes/origin/'):
            branches.append(r[len('refs/remotes/origin/'):])
        elif r.startswith('refs/remotes/changes/'):
            changes.append(r[len('refs/remotes/changes/'):])
    return branches, changes


def parse_change_refs(d):
    """解析 refs/changes：sha → [localId]（head 引用），localId → 目标分支 tip sha"""
    out = sh(f'git -C "{d}" ls-remote origin "refs/changes/*"', timeout=300)
    head_map, target_map = {}, {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        sha, ref = parts
        m = re.match(r'refs/changes/(\d+)/head$', ref)
        if m:
            head_map.setdefault(sha, []).append(m.group(1))
        m = re.match(r'refs/changes/(\d+)/target/\d+$', ref)
        if m:
            target_map[m.group(1)] = sha
    return head_map, target_map


def _is_develop(branch):
    return branch in ('origin/develop', 'origin/HEAD') or branch.startswith('origin/develop')


def find_mr(repo_path, pat, submit_no, a8):
    """按提交编号找到 commit + MR localId（优先选「合入 develop」的那个 MR）"""
    d, err = ensure_repo(repo_path, pat)
    if not d:
        return None, None, f'克隆失败: {err[:120]}'
    raw = sh(f'git -C "{d}" log --all --format="%H|%ad|%s" --date=short -i --grep="{submit_no}"', timeout=300)
    head_map, target_map = parse_change_refs(d)

    cands = []
    for line in raw.splitlines():
        if '|' not in line:
            continue
        sha, dt, subj = line.split('|', 2)
        if submit_no not in subj:
            continue
        allrefs = branches_containing(d, sha)
        branches, ch_ids = split_refs(allrefs)
        local_ids = ch_ids or head_map.get(sha, [])
        tbranches = set()
        for lid in local_ids:
            b, _ = split_refs(branches_containing(d, target_map.get(lid)))
            tbranches |= set(b)
        dev_target = any(_is_develop(b) for b in tbranches)
        is_cherry = any('cherry-pick' in b for b in branches)
        junk = _is_junk(subj)
        # 打分（用户 2026-09-11 确认 = 方案 A：原始完整提交优先）
        #   ① 有 change 引用（能给出 MR 链接）最优先
        #   ② 信息完整 > 脏消息；原始提交 > cherry-pick 副本；同分取最早的
        score = (10000 if local_ids else 0) \
                + (1000 if (not junk and not is_cherry) else
                   (100 if not junk else (10 if not is_cherry else 1)))
        cands.append({'sha': sha, 'date': dt, 'subject': subj, 'branches': branches,
                      'local_ids': local_ids, 'targets': sorted(tbranches),
                      'junk': junk, 'cherry': is_cherry, 'dev': dev_target, 'score': score})
    if not cands:
        return None, None, '仓库内未找到该提交编号的提交'

    top = max(c['score'] for c in cands)
    tied = [c for c in cands if c['score'] == top]
    best = sorted(tied, key=lambda c: c['date'])[0]      # 同分取最早的（原始提交）

    # 审计信息：列出所有候选，便于人工复核
    if len(cands) > 1:
        log(f'         ⓘ {submit_no} 有 {len(cands)} 个候选提交：')
        for c in sorted(cands, key=lambda x: x['score'], reverse=True):
            tag = ('[→develop]' if c['dev'] else '') + ('[脏消息]' if c['junk'] else '') \
                  + ('[cherry-pick]' if c['cherry'] else '')
            tl = ','.join(t.replace('origin/', '') for t in c['targets']) or '?'
            log(f'           {c["sha"][:8]} {c["date"]} score={c["score"]:6d} '
                f'change={",".join(c["local_ids"]) or "-"} target={tl} {tag} '
                f'{(c["branches"] or [""])[0]}')

    if not best['local_ids']:
        return best['sha'], None, '该提交无 change 引用（MR 未创建？）'
    return best['sha'], best['local_ids'][0], \
        f"{len(cands)} 个候选 → 选用 {best['sha'][:8]}（{','.join(best['targets']) or best['branches'][:1]}）"


def build_fe_be(info):
    issue = re.match(r'#([A-Za-z0-9-]+)', (info or '').strip())
    issue = issue.group(1) if issue else ''
    mb = (re.search(r'后端(?:编号|编码)[：:]\s*([A-Z0-9-]+)', info or '')
          or re.search(r'【后端[：:]\s*([A-Z0-9-]+)', info or ''))
    be = mb.group(1) if mb else ''
    s = (f'【后端：{be}】' if be else '') + (f'【前端：{issue}】' if issue else '')
    return s or '无', ('是' if be else '否')


# ---------------------------------------------------------------- 步骤 4
def read_target():
    d = mcporter('sheet.get_cell_data', {
        'file_id': TARGET_FILE_ID, 'sheet_id': TARGET_SHEET_ID,
        'start_col': 0, 'end_col': 2, 'start_row': 0, 'end_row': 400})
    grid = {}
    for c in d.get('cells', []):
        v = (c.get('string_value') or '').strip()
        if v:
            grid[(c['row'], c['col'])] = v
    existing = set()
    last = 0
    for row in range(1, 400):
        key = (grid.get((row, 0), ''), grid.get((row, 1), ''), grid.get((row, 2), ''))
        if key[0] or key[1]:
            existing.add(key)
            last = row
    return existing, last


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', help='YYYY-MM-DD，默认今天（Asia/Shanghai）')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    day = (datetime.date.fromisoformat(args.date) if args.date
           else datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date())
    log(f'=== 同步无纸化代码复核表 · {day} {"(DRY-RUN)" if args.dry_run else ""} ===')

    pat = codeup_pat()
    download_source()
    rows, total_today = filter_rows(SRC_XLSX, day)
    if not rows:
        log(f'\n✅ 无新增：{day} 没有符合条件的记录（写入口径 0 条）。源表口径 {total_today} 条。')
        log(f'🔗 https://docs.qq.com/sheet/DQWZ1aUJFc1VCcFFF')
        return

    log('[3/6] 反查 Codeup MR …')
    prepared = []
    for r in rows:
        prod, no, a8, info = r[C_PROD], r[C_NO], (r[C_A8] or '无'), (r[C_INFO] or '')
        sha = local_id = None
        note = ''
        for repo in REPO_CANDIDATES.get(prod, []):
            sha, local_id, note = find_mr(repo, pat, no, a8)
            if sha:                     # ⚠️ 只要提交在该仓库存在就锁定，不再试下一个仓库——
                repo_used = repo        # 否则会在另一个仓库里撞上无关的同编号提交
                break
        if local_id:
            url = f'{GIT_BASE}/{repo_used}/change/{local_id}'
            log(f'      ✅ {prod:12s} {no}  →  {repo_used.split("/")[-1]} change/{local_id}')
        else:
            url = 'MR待解析'
            log(f'      ⚠️  {prod:12s} {no}  →  {note}')
        febe, feflag = build_fe_be(info)
        prepared.append({'prod': prod, 'no': no, 'a8': a8, 'info': info,
                         'proj': r[C_PROJ] or '', 'url': url, 'febe': febe, 'feflag': feflag,
                         'sha': sha, 'note': note})

    log('[4/6] 读取目标表去重 …')
    existing, last_row = read_target()
    new = [p for p in prepared if (DEV, p['no'], p['a8']) not in existing]
    dup = [p for p in prepared if (DEV, p['no'], p['a8']) in existing]
    for p in dup:
        log(f'      ⏭️  已存在：{p["no"]} / {p["a8"]}')
    log(f'      → 新增 {len(new)} 条，已存在 {len(dup)} 条')

    if not new:
        log(f'\n✅ 同步已完成：{len(prepared)} 条记录全部已存在于目标表，无需写入。')
        log(f'🔗 https://docs.qq.com/sheet/DQWZ1aUJFc1VCcFFF')
        return

    values = []
    for i, p in enumerate(new):
        row = last_row + 1 + i
        cells = {T_DEV: DEV, T_MONTHNO: p['no'], T_A8: p['a8'], T_FEBE: p['febe'],
                 T_PROJ: p['proj'], T_DESC: p['info'], T_URL: p['url'],
                 T_INIT: '待初审', T_FINAL: '待终审', T_REVIEW: '待复核',
                 T_MERGE: '已合并', T_FEBE_FLAG: p['feflag']}
        p['row'] = row
        for c, v in cells.items():
            values.append({'row': row, 'col': c, 'value_type': 'STRING', 'string_value': str(v)})
        log(f'      row{row}  {p["prod"]:12s} {p["no"]}  febe={p["feflag"]}  {p["url"]}')

    if args.dry_run:
        log('\n[dry-run] 不写入。')
        return

    log('[5/6] 写入暂存表 …')
    res = mcporter('sheet.set_range_value', {'file_id': TARGET_FILE_ID, 'sheet_id': TARGET_SHEET_ID, 'values': values})
    if res.get('_error') or ('error' in res and res.get('error')):
        raise SystemExit(f'ERROR: 写入失败 {res}')
    log(f'      ✅ 写入 {len(values)} 个单元格')

    log('[6/6] 回读校验 …')
    d = mcporter('sheet.get_cell_data', {
        'file_id': TARGET_FILE_ID, 'sheet_id': TARGET_SHEET_ID,
        'start_col': 0, 'end_col': 22, 'start_row': 0, 'end_row': last_row + len(new)})
    g = {}
    for c in d.get('cells', []):
        v = (c.get('string_value') or '').strip()
        if v:
            g[(c['row'], c['col'])] = v
    required = [T_DEV, T_MONTHNO, T_A8, T_FEBE, T_PROJ, T_DESC, T_URL,
                T_INIT, T_FINAL, T_REVIEW, T_MERGE, T_FEBE_FLAG]
    ok = True
    for p in new:
        miss = [c for c in required if not g.get((p['row'], c))]
        if miss:
            ok = False
            log(f'      ❌ row{p["row"]} 缺列 {miss}')
        else:
            log(f'      ✅ row{p["row"]} {p["no"]} 12 列齐全')
    log(f'\n{"✅" if ok else "⚠️"} 同步完成：新增 {len(new)} 条（源表口径 {total_today} 条）')
    log('🔗 https://docs.qq.com/sheet/DQWZ1aUJFc1VCcFFF')
    if not ok:
        sys.exit(2)


if __name__ == '__main__':
    main()
