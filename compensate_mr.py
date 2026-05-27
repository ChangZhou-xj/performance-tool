#!/usr/bin/env python3
"""
补偿阶段脚本：查询 Codeup MR 并更新目标表
用法：python3 compensate_mr.py
前提：CODEUP_PAT 已配置在 ~/performance-tool/.env 中
"""

import os
import re
import json
import subprocess
import sys

# ===== 配置 =====
FILE_ID = "DQXpETkpFdGh3emtO"
SHEET_ID = "gllec0"
ORGANIZATION_ID = "5ea04ae0f89c9700014a57dc"

# 仓库映射
REPO_MAP = {
    "pcx": {
        "path": "fruits/orange/product/pcx",
        "repositoryId": 4764536,
    },
    "gwwy-uniapp": {
        "path": "fruits/lemon/gwwy-uniapp",
        "repositoryId": None,  # 未知，需要查
    },
}

# MR 查询优先级
MR_SEARCH_ORDER = [
    {"state": "merged", "branch": "develop"},
    {"state": "merged", "branch": "dev_test"},
    {"state": "opened", "branch": "develop"},
    {"state": "opened", "branch": "dev_test"},
]

# ===== 加载 PAT =====
def load_pat():
    env_path = os.path.expanduser("~/performance-tool/.env")
    pat = None
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("CODEUP_PAT="):
                    pat = line.split("=", 1)[1].strip().strip("'\"")
                    break
    if not pat:
        print("ERROR: CODEUP_PAT not found in ~/performance-tool/.env")
        print("Please add: CODEUP_PAT=pt-你的令牌值")
        sys.exit(1)
    return pat

# ===== MR 查询 =====
def query_mr(pat, issue, product):
    """查询 Codeup MR，按优先级顺序搜索"""
    repo = REPO_MAP.get(product)
    if not repo or not repo["repositoryId"]:
        print(f"  SKIP: {product} repositoryId unknown")
        return None

    repo_id = repo["repositoryId"]

    for search in MR_SEARCH_ORDER:
        state = search["state"]
        target_branch = search["branch"]

        # Codeup ListMergeRequests API
        url = f"https://codeup.aliyun.com/api/v4/projects/{repo_id}/merge_requests"
        params = {
            "state": state,
            "target_branch": target_branch,
            "per_page": 20,
        }

        # Build curl command with PAT auth
        curl_cmd = ["curl", "-s", "-H", f"PRIVATE-TOKEN: {pat}"]
        for k, v in params.items():
            curl_cmd.extend(["--data-urlencode", f"{k}={v}"])
        curl_cmd.append(url)

        try:
            result = subprocess.run(curl_cmd, capture_output=True, text=True, timeout=10)
            mrs = json.loads(result.stdout)

            for mr in mrs:
                title = mr.get("title", "")
                # Match: #号开头 + 【之前
                m = re.match(r'#([A-Za-z0-9_-]+)', title.strip())
                if m and m.group(1) == issue:
                    local_id = mr.get("local_id", mr.get("id", ""))
                    mr_state = mr.get("state", "")
                    mr_status = mr.get("status", "")

                    # Build MR URL
                    mr_url = f"https://codeup.aliyun.com/{repo['path']}/change/{local_id}"

                    # Map status
                    if mr_state.upper() == "MERGED":
                        status_text = "已合并"
                    elif mr_state.upper() in ("TO_BE_MERGED", "OPENED"):
                        status_text = "待合并"
                    elif mr_state.lower() == "opened" and mr_status is None:
                        status_text = "待合并"
                    else:
                        status_text = "待合并"

                    search_order = f"{state}/{target_branch}"
                    print(f"  HIT: {search_order} -> MR#{local_id} [{status_text}] {mr_url}")
                    return {
                        "mr_url": mr_url,
                        "mr_status": status_text,
                        "local_id": local_id,
                        "search_order": search_order,
                    }
        except Exception as e:
            print(f"  WARN: query failed for {state}/{target_branch}: {e}")
            continue

    print(f"  MISS: no MR found for issue {issue}")
    return None

# ===== 更新目标表 =====
def update_target_sheet(rows_to_update):
    """批量更新目标表的 col6(MR链接) 和 col10(合并状态)"""
    values = []
    for row, data in rows_to_update:
        if data:
            # col 6: 地址 (MR URL 纯文本)
            values.append({
                "row": row, "col": 6,
                "value_type": "STRING",
                "string_value": data["mr_url"]
            })
            # col 10: 合并状态
            values.append({
                "row": row, "col": 10,
                "value_type": "STRING",
                "string_value": data["mr_status"]
            })
        else:
            # 保留 MR待解析 (不更新)
            pass

    if not values:
        print("No MR data to update")
        return

    request = {
        "file_id": FILE_ID,
        "sheet_id": SHEET_ID,
        "values": values
    }

    # Call mcporter set_range_value
    args_json = json.dumps(request, ensure_ascii=False)
    cmd = f'mcporter call "tencent-docs" "sheet.set_range_value" --args \'{args_json}\''
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    print(f"\nset_range_value result: {result.stdout.strip()}")

    if result.returncode != 0:
        print(f"ERROR: {result.stderr.strip()}")

    # Then set_link for each MR URL
    for row, data in rows_to_update:
        if data:
            set_link_args = json.dumps({
                "file_id": FILE_ID,
                "sheet_id": SHEET_ID,
                "row": row,
                "col": 6,
                "link_url": data["mr_url"],
                "display_text": data["mr_url"],
            }, ensure_ascii=False)
            cmd = f'mcporter call "tencent-docs" "sheet.set_link" --args \'{set_link_args}\''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
            print(f"  set_link row {row}: {result.stdout.strip()[:100]}")

# ===== 主流程 =====
def main():
    pat = load_pat()

    # Load records needing MR update
    with open("/tmp/new_records.json") as f:
        data = json.load(f)

    new_records = data["new_records"]
    first_empty_row = data["first_empty_row"]

    print(f"Records to query: {len(new_records)}")

    rows_to_update = []
    for i, r in enumerate(new_records):
        row = first_empty_row + i
        issue_raw = r.get("问题描述", "")
        product = r.get("产品标识", "")

        # Extract issue number
        m = re.match(r'#([A-Za-z0-9-_]+)', issue_raw.strip())
        issue = m.group(1) if m else ""

        # Strip suffix like _1-hjh- for matching
        # The MR title format is #20260430001【需求】xxx
        # So we need the base issue number without _1-hjh- suffix
        base_issue = re.match(r'([A-Za-z0-9]+)', issue).group(1) if issue else ""

        print(f"\n[{i}] Row {row}: issue={issue} (base={base_issue}) product={product}")

        mr_data = query_mr(pat, base_issue, product)
        rows_to_update.append((row, mr_data))

    # Update target sheet
    print(f"\n===== Updating target sheet =====")
    update_target_sheet(rows_to_update)

    # Summary
    hit_count = sum(1 for _, d in rows_to_update if d)
    miss_count = sum(1 for _, d in rows_to_update if not d)
    print(f"\nResult: {hit_count} MR found, {miss_count} MR not found (kept MR待解析)")
    print(f"Target: https://docs.qq.com/sheet/{FILE_ID}?tab={SHEET_ID}")

if __name__ == "__main__":
    main()