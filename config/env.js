/**
 * 环境配置
 *
 * 云开发环境 ID 集中在此，避免散落在业务代码里。
 * 好处：换环境（测试 ↔ 正式）时只改这一处；
 * 也便于将来用不同的构建产物区分多环境。
 */

// 云开发环境 ID，必须与微信开发者工具中 cloudfunctions 目录选中的环境一致
const CLOUD_ENV_ID = 'your-cloud-env-id'

module.exports = {
  CLOUD_ENV_ID
}
