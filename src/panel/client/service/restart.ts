import { postHostRestart } from '../apis'
import { ApiError } from '../apis'

/**
 * 请求宿主重启（进程级，带活跃工作安全闸）。
 *
 * 返回 void 而不是 `{ ok, error? }`：重启必然切断这次请求（Host 进程被替换），
 * 「拿到失败再判断」在这个接口上没有可用的失败语义。区分两类异常：
 *
 *  - `ApiError`：宿主明确拒绝（409 被活跃会话挡住 / 503 不在桌面应用 / 助手缺失），
 *    必须抛给调用方展示原因，**不能**吞掉——否则用户点了一次重启，什么都没发生。
 *  - 其它（连接中断 / abort）：这就是成功路径，宿主正在退出，调用方靠轮询探测恢复。
 */
export async function restartHost(): Promise<void> {
  try {
    await postHostRestart()
  }
  catch (error) {
    if (error instanceof ApiError)
      throw error
  }
}
