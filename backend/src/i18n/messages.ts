export type Locale = 'en' | 'zh';

export type MessageKey =
  | 'session.notFound'
  | 'session.newChat'
  | 'session.newRoom'
  | 'session.patchNeedField'
  | 'contact.notFound'
  | 'contact.nameRequired'
  | 'contact.inUse'
  | 'contact.saveFailed'
  | 'contact.deleteFailed'
  | 'room.needTwoMembers'
  | 'room.notARoom'
  | 'room.noBypass'
  | 'room.memberNotFound'
  | 'assemble.roomPersonality'
  | 'assemble.roomQuote'
  | 'thread.notFound'
  | 'thread.main'
  | 'thread.bypass'
  | 'thread.parentNotFound'
  | 'thread.anchorNotFound'
  | 'thread.anchorWrongParent'
  | 'thread.cannotDeleteRoot'
  | 'thread.createFailed'
  | 'thread.updateFailed'
  | 'thread.deleteFailed'
  | 'profile.notFound'
  | 'profile.noneConfigured'
  | 'profile.apiKeyMissing'
  | 'profile.modelMissing'
  | 'profile.keepAtLeastOne'
  | 'profile.defaultNotFound'
  | 'profile.unnamed'
  | 'profile.defaultName'
  | 'profile.invalid'
  | 'settings.saveFailed'
  | 'export.pathRequired'
  | 'export.failed'
  | 'chat.failed'
  | 'chat.contextOverflow'
  | 'upstream.modelError'
  | 'upstream.noBody'
  | 'upstream.emptySummary'
  | 'assemble.bypassInclude'
  | 'assemble.anchorLabel'
  | 'assemble.noBypassMessages'
  | 'assemble.aboutQuote'
  | 'assemble.summarySystem'
  | 'assemble.summaryUser'
  | 'assemble.emptyTranscript'
  | 'assemble.bypassSummary'
  | 'export.anchorQuote'
  | 'export.bypassLink';

type Dict = Record<MessageKey, string>;

const en: Dict = {
  'session.notFound': 'Session not found',
  'session.newChat': 'New chat',
  'session.newRoom': 'New room',
  'session.patchNeedField': 'Provide at least title or model_profile_id',
  'contact.notFound': 'Contact not found',
  'contact.nameRequired': 'Contact name is required',
  'contact.inUse': 'Contact is still a member of a room',
  'contact.saveFailed': 'Failed to save contact',
  'contact.deleteFailed': 'Failed to delete contact',
  'room.needTwoMembers': 'A room needs at least two contacts',
  'room.notARoom': 'Not a multi-AI room',
  'room.noBypass': 'Multi-AI rooms do not support bypass threads',
  'room.memberNotFound': 'Contact is not a room member',
  'assemble.roomPersonality':
    'You are "{name}" in a multi-AI chat room. Follow this persona:\n{prompt}',
  'assemble.roomQuote': 'Replying to: 「{quote}」\n\n{content}',
  'thread.notFound': 'Thread not found',
  'thread.main': 'Main chat',
  'thread.bypass': 'Bypass',
  'thread.parentNotFound': 'Parent thread not found',
  'thread.anchorNotFound': 'Anchor message not found',
  'thread.anchorWrongParent': 'Anchor message does not belong to the parent thread',
  'thread.cannotDeleteRoot': 'Cannot delete the root thread',
  'thread.createFailed': 'Failed to create bypass',
  'thread.updateFailed': 'Update failed',
  'thread.deleteFailed': 'Delete failed',
  'profile.notFound': 'Model profile not found',
  'profile.noneConfigured': 'No model configured. Add a profile in Settings first.',
  'profile.apiKeyMissing': 'API Key is not configured. Fill it in Settings first.',
  'profile.modelMissing': 'Model name is not configured',
  'profile.keepAtLeastOne': 'Keep at least one model profile',
  'profile.defaultNotFound': 'Default model profile does not exist',
  'profile.unnamed': 'Untitled',
  'profile.defaultName': 'Default',
  'profile.invalid': 'Invalid configuration',
  'settings.saveFailed': 'Failed to save settings',
  'export.pathRequired': 'Provide a save path when exporting',
  'export.failed': 'Export failed',
  'chat.failed': 'Chat failed',
  'chat.contextOverflow':
    'Including bypasses exceeds the context window. Auto-summarize and compress before sending?',
  'upstream.modelError': 'Upstream model error ({status}): {detail}',
  'upstream.noBody': 'Upstream response has no body',
  'upstream.emptySummary': 'Upstream returned an empty summary',
  'assemble.bypassInclude': '[Bypass include · {title}]\nAnchor quote: {quote}\n\n{body}',
  'assemble.anchorLabel': 'Anchor quote: {quote}',
  'assemble.noBypassMessages': '(No bypass messages yet)',
  'assemble.aboutQuote': 'About this text: 「{quote}」\n\n{content}',
  'assemble.summarySystem':
    'You are a dialogue summarizer. Concisely summarize the following bypass clarification in English. Keep key conclusions and open questions. No small talk.',
  'assemble.summaryUser':
    'Thread title: {title}\nAnchor quote: {quote}\n\nDialogue:\n{transcript}',
  'assemble.emptyTranscript': '(empty)',
  'assemble.bypassSummary': '[Bypass summary · {title}]\nAnchor quote: {quote}\n\n{summary}',
  'export.anchorQuote': '> Anchor quote: {quote}\n',
  'export.bypassLink': '→ [Bypass: {title}]({rel})\n',
};

const zh: Dict = {
  'session.notFound': '会话不存在',
  'session.newChat': '新对话',
  'session.newRoom': '新聊天室',
  'session.patchNeedField': '至少提供 title 或 model_profile_id',
  'contact.notFound': '联系人不存在',
  'contact.nameRequired': '联系人名称不能为空',
  'contact.inUse': '该联系人仍在某个聊天室中',
  'contact.saveFailed': '保存联系人失败',
  'contact.deleteFailed': '删除联系人失败',
  'room.needTwoMembers': '聊天室至少需要两名联系人',
  'room.notARoom': '不是多 AI 聊天室',
  'room.noBypass': '多 AI 聊天室不支持旁路',
  'room.memberNotFound': '该联系人不是本室成员',
  'assemble.roomPersonality':
    '你是多 AI 聊天室中的「{name}」。请遵循以下人设：\n{prompt}',
  'assemble.roomQuote': '正在回复：「{quote}」\n\n{content}',
  'thread.notFound': '线程不存在',
  'thread.main': '主对话',
  'thread.bypass': '旁路',
  'thread.parentNotFound': '父线程不存在',
  'thread.anchorNotFound': '锚点消息不存在',
  'thread.anchorWrongParent': '锚点消息不属于父线程',
  'thread.cannotDeleteRoot': '不能删除根线程',
  'thread.createFailed': '创建旁路失败',
  'thread.updateFailed': '更新失败',
  'thread.deleteFailed': '删除失败',
  'profile.notFound': '模型配置不存在',
  'profile.noneConfigured': '未配置模型，请先在设置中添加模型配置',
  'profile.apiKeyMissing': 'API Key 未配置，请先在设置中填写',
  'profile.modelMissing': '模型名称未配置',
  'profile.keepAtLeastOne': '至少保留一条模型配置',
  'profile.defaultNotFound': '默认模型配置不存在',
  'profile.unnamed': '未命名',
  'profile.defaultName': '默认',
  'profile.invalid': '配置无效',
  'settings.saveFailed': '保存设置失败',
  'export.pathRequired': '请在导出时提供保存路径',
  'export.failed': '导出失败',
  'chat.failed': '对话失败',
  'chat.contextOverflow': '纳入旁路后上下文超出窗口，是否自动归纳压缩后发送？',
  'upstream.modelError': '上游模型错误 ({status}): {detail}',
  'upstream.noBody': '上游响应无 body',
  'upstream.emptySummary': '上游返回空归纳结果',
  'assemble.bypassInclude': '[旁路纳入 · {title}]\n锚点选区：{quote}\n\n{body}',
  'assemble.anchorLabel': '锚点选区：{quote}',
  'assemble.noBypassMessages': '（尚无旁路消息）',
  'assemble.aboutQuote': '关于这段文字：「{quote}」\n\n{content}',
  'assemble.summarySystem':
    '你是对话归纳助手。请用简洁中文归纳下列旁路澄清对话的要点，保留关键结论与未决问题。不要寒暄。',
  'assemble.summaryUser':
    '线程标题：{title}\n锚点选区：{quote}\n\n对话：\n{transcript}',
  'assemble.emptyTranscript': '（空）',
  'assemble.bypassSummary': '[旁路归纳 · {title}]\n锚点选区：{quote}\n\n{summary}',
  'export.anchorQuote': '> 锚点选区：{quote}\n',
  'export.bypassLink': '→ [旁路澄清：{title}]({rel})\n',
};

export const messages: Record<Locale, Dict> = { en, zh };
