# 青龙任务脚本「source 执行」回归测试

守护的坑：**青龙任务跑完了，面板却一直显示「运行中」。**

## 为什么会踩

青龙 2.21 的 `/ql/shell/otask.sh` 对 `.sh` 任务是 **source 执行**，不是另起子进程：

```sh
define_program() { ... elif [[ $file_param == *.sh ]]; then which_program="." ... }
run_normal()     { ... $timeoutCmd $which_program $file_param ... }
```

即 `task task_performance-tool/ql-task.sh` 实际是 `. task_performance-tool/ql-task.sh`，
脚本跑在 `task.sh` 自己的 shell 进程里。完整顺序是：

```
handle_task_start（上报 status=0「运行中」+ 建运行实例）
  →  . ql-task.sh            ← 我们的脚本
  →  run_task_after
  →  handle_task_end（/open/crons/status status=1 + 耗时 + 结束运行实例）
```

所以脚本里任何位置的 `exit` 都会**直接终止 task.sh**，`handle_task_end` 永远执行不到：

- 面板收不到「完成」，状态永久停留在「运行中」；
- `running_instances` 每次运行新增一条永不结束的记录（按天累积，历史面板上出现过「×37 / 已运行 800+ 小时 / 共 75 个」）。

## 写法要求

1. 结尾不能用裸 `exit`：被 source 时用 `return "$EXIT_CODE"` 交还控制权，直接执行时才 `exit`；
2. 不要在收尾前留下 `set -u`：它会污染调用方 shell，让 `handle_task_end` 报 `unbound variable`，同样丢上报。

正确写法见 `ql-task.sh` 末尾：

```sh
set +u
if [ "$QL_TASK_SOURCED" = "1" ]; then
	return "$EXIT_CODE"
fi
exit "$EXIT_CODE"
```

其中 `QL_TASK_SOURCED` 由脚本开头的 `if ( return 0 2>/dev/null )` 判定。
注意：这个判定**不能封成函数**再调用——函数体会让 `return` 合法，导致永远判成「被 source」。

## 测试覆盖

| 断言 | 对应线上故障 |
| --- | --- |
| source 执行后 `handle_task_end` 执行到 | 面板一直显示「运行中」 |
| 退出码正确透传（失败场景 `rc=3`） | 失败被吞掉 / 面板该显示「失败」却卡在运行中 |
| `set -u` 不残留到调用方 shell | `handle_task_end` 报 unbound variable |
| `bash` / `dash` 直接执行仍 `exit 0` | 本地 `npm run ql:a8-fill` 等包装方式不被改坏 |
| 反向对照：故意用 `exit` 的脚本必须失败 | 防止本测试本身变成空转 |

## 运行

```bash
npm run test:ql-task
# 或
sh test/shell/ql-task-sourced/run.sh
```

- 全部在 `mktemp -d` 的临时目录里跑，`npm` / `node` 都是桩（`lib/bin/`），**不联网、不下载工作记录、不发邮件、不写仓库 `data/`**。
- 依赖 `bash`；`dash` 存在时会额外跑一遍 `-n` 语法检查和直接执行检查。
- Windows 上请在 Git Bash 里执行（`bash` 需是 Git/MSYS 的 bash，而不是 `C:\Windows\System32\bash.exe` 这个 WSL 入口）；与 `npm run ql:a8-fill` 等脚本的要求一致。
- 退出码非 0 即表示有断言失败，失败项会指出是「丢 control」还是「退出码没透传」。

## 局限

本测试只验证「控制权交还 / 退出码 / shell 选项泄漏」这层契约，不覆盖业务逻辑（填报、报表、邮件由 `test/*.test.js` 与真机跑验证）。
