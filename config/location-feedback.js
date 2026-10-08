/**
 * 地点反馈的客户端副本（类型标签闭合集合 + 长度上限）
 *
 * 本文件是 cloudfunctions-shared/locationFeedback.js 的**独立副本**，
 * 沿用 config/cities.js 的既有约定：客户端不 require 云函数目录，
 * 因此必须各存一份，并由自检脚本防止两边漂移。
 *
 * 校验入口：scripts/e2e-degrade-verify.js 静态层会逐项比对两份清单，
 * 任一处改动而另一处没跟上会直接判定失败。
 * 真正的校验权威在服务端（submitLocationFeedback），这里的清单只用于渲染选项。
 */

/** 类型标签：封闭集合，用户在界面上只能选、不能填。 */
const FEEDBACK_CATEGORIES = [
  '自然风光',
  '城市街景',
  '室内场景',
  '公园绿地',
  '水域',
  '山地',
  '其他'
]

const NAME_MAX = 30
const NOTE_MAX = 30
const ADDRESS_MAX = 60

module.exports = {
  FEEDBACK_CATEGORIES,
  NAME_MAX,
  NOTE_MAX,
  ADDRESS_MAX
}
