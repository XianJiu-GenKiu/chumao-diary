// 云函数：login
// 功能：用户登录 — 获取 openId，创建或更新用户记录
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const unionId = wxContext.UNIONID || ''
  const wechatAppId = wxContext.APPID || ''
  const userInfo = (event && event.userInfo) || {}

  if (!openid) {
    return { code: -1, message: '无法获取用户身份' }
  }

  try {
    // users 集合由初始化数据创建。登录路径不能每次尝试 createCollection：
    // 该管理操作会显著拉长执行时间，容易超过云函数的默认限制。
    const userRes = await db.collection('users').where({ openId: openid }).get()

    if (userRes.data.length > 0) {
      const existingUser = userRes.data[0]
      if (existingUser.status === 'banned') {
        return { code: -403, message: '账号已被封禁，请联系管理员' }
      }
      // 为历史账户补齐微信绑定字段；OpenID 是本小程序内稳定且唯一的微信身份。
      const updateData = {}
      if (existingUser.wechatOpenId !== openid) updateData.wechatOpenId = openid
      if (unionId && existingUser.unionId !== unionId) updateData.unionId = unionId
      if (wechatAppId && existingUser.wechatAppId !== wechatAppId) updateData.wechatAppId = wechatAppId
      if (userInfo && Object.keys(userInfo).length > 0) {
        const { nickName, avatarUrl, gender } = userInfo
        updateData.nickname = nickName || existingUser.nickname || ''
        updateData.avatar = avatarUrl || existingUser.avatar || ''
        updateData.gender = gender || 0
      }
      if (Object.keys(updateData).length > 0) {
        await db.collection('users').where({ openId: openid }).update({
          data: updateData
        })
      }
      // 不再为返回值发起第二次数据库查询，保持登录调用尽可能轻量。
      return { code: 0, data: { ...existingUser, ...updateData, openId: openid } }
    }

    // 新用户 — 创建记录
    const newUser = {
      openId: openid,
      wechatOpenId: openid,
      unionId,
      wechatAppId,
      nickname: userInfo.nickName || '毛毛用户',
      avatar: userInfo.avatarUrl || '',
      gender: userInfo.gender || 0,
      friendIds: [],
      followingIds: [],
      groupIds: [],
      createdAt: db.serverDate(),
      lastLoginAt: db.serverDate()
    }

    await db.collection('users').add({ data: newUser })

    // 去掉 _openid 等内部字段后返回
    return { code: 0, data: { openId: openid, ...newUser } }
  } catch (err) {
    console.error('login 云函数出错:', err)
    return { code: -1, message: '登录失败', error: err.message }
  }
}
