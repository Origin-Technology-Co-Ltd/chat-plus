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
  | 'room.needOneMember'
  | 'room.notARoom'
  | 'room.noBypass'
  | 'room.memberNotFound'
  | 'meeting.goalRequired'
  | 'meeting.needTwoMembers'
  | 'meeting.hostMustBeMember'
  | 'meeting.notActive'
  | 'meeting.notAiHost'
  | 'meeting.ended'
  | 'meeting.noSpeaker'
  | 'meeting.paused'
  | 'meeting.tooFast'
  | 'meeting.rateLimited'
  | 'meeting.hostUser'
  | 'meeting.hostAi'
  | 'meeting.hostAiUnknown'
  | 'meeting.hostSayContact'
  | 'meeting.hostSayUser'
  | 'meeting.hostSayEnd'
  | 'meeting.userHostSayContact'
  | 'meeting.userHostSayUser'
  | 'meeting.confirmAskSay'
  | 'meeting.confirmAnswerSay'
  | 'meeting.confirmNeedTwoOptions'
  | 'meeting.confirmNotPending'
  | 'meeting.confirmInvalidChoice'
  | 'meeting.confirmPending'
  | 'meeting.summarySystem'
  | 'meeting.summaryUser'
  | 'meeting.summaryFallback'
  | 'assemble.roomPersonality'
  | 'assemble.roomQuote'
  | 'assemble.meetingSpeak'
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
  'room.needOneMember': 'A room needs at least one contact',
  'room.notARoom': 'Not a multi-AI room',
  'room.noBypass': 'Multi-AI rooms do not support bypass threads',
  'room.memberNotFound': 'Contact is not a room member',
  'meeting.goalRequired': 'Meeting goal is required',
  'meeting.needTwoMembers': 'Meetings need at least two members',
  'meeting.hostMustBeMember': 'AI host must be a room member',
  'meeting.notActive': 'Meeting is not active',
  'meeting.notAiHost': 'Session does not have an AI host',
  'meeting.ended': 'Meeting has ended',
  'meeting.noSpeaker': 'No AI speaker is assigned for this turn',
  'meeting.paused': 'Meeting auto-speak is paused. Resume to continue.',
  'meeting.tooFast': 'Speakers are changing too quickly. Wait a moment.',
  'meeting.rateLimited':
    'Meeting paused: too many AI turns in a short time. Resume when ready.',
  'meeting.hostUser': 'You (host)',
  'meeting.hostAi': '{name} (host)',
  'meeting.hostAiUnknown': 'AI host',
  'meeting.hostSayContact': 'Please speak, @{name}. {reason}',
  'meeting.hostSayUser': 'Please speak, user. {reason}',
  'meeting.hostSayEnd': 'I think we can wrap up. {reason}',
  'meeting.userHostSayContact': 'Please speak, @{name}.',
  'meeting.userHostSayUser': 'I will speak next.',
  'meeting.confirmAskSay':
    'Please confirm: {title}\n{prompt}\nOptions:\n{options}\nPick one or more, and rate them if needed.',
  'meeting.confirmAnswerSay': 'Confirmation · {title}\nSelected: {selected}\nComment: {comment}',
  'meeting.confirmNeedTwoOptions': 'Provide at least two options to confirm',
  'meeting.confirmNotPending': 'No confirmation is waiting',
  'meeting.confirmInvalidChoice': 'Select at least one valid option',
  'meeting.confirmPending': 'Finish the pending confirmation before continuing',
  'meeting.summarySystem':
    'You are the meeting host wrapping up. Goal: {goal}\nWrite a concise summary in the same language as the discussion: key agreements, remaining disagreements, decisions, and next steps. No small talk. Use markdown headings.',
  'meeting.summaryUser': 'End reason: {reason}\nTranscript:\n{transcript}',
  'meeting.summaryFallback': 'Meeting ended. {reason}',
  'assemble.roomPersonality':
    'You are "{name}" in a multi-AI chat room. Follow this persona:\n{prompt}',
  'assemble.roomQuote': 'Replying to: 「{quote}」\n\n{content}',
  'assemble.meetingSpeak':
    'Meeting goal: {goal}\nYou have been called to speak in this meeting. Share your perspective and help move the discussion forward.',
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
  'room.needOneMember': '聊天室至少需要一名联系人',
  'room.notARoom': '不是多 AI 聊天室',
  'room.noBypass': '多 AI 聊天室不支持旁路',
  'room.memberNotFound': '该联系人不是本室成员',
  'meeting.goalRequired': '请填写会议目标',
  'meeting.needTwoMembers': '会议至少需要两名成员',
  'meeting.hostMustBeMember': 'AI 主持人必须是室成员',
  'meeting.notActive': '会议未在进行中',
  'meeting.notAiHost': '当前不是 AI 主持',
  'meeting.ended': '会议已结束',
  'meeting.noSpeaker': '当前没有轮到 AI 发言',
  'meeting.paused': '会议自动发言已暂停，请手动恢复后继续',
  'meeting.tooFast': '发言过快，请稍后再继续',
  'meeting.rateLimited': '会议已暂停：短时间内 AI 发言次数过多，确认后可恢复',
  'meeting.hostUser': '你（主持）',
  'meeting.hostAi': '{name}（主持）',
  'meeting.hostAiUnknown': 'AI 主持',
  'meeting.hostSayContact': '请 @{name} 发言。{reason}',
  'meeting.hostSayUser': '请用户发言。{reason}',
  'meeting.hostSayEnd': '这次会议可以结束了。{reason}',
  'meeting.userHostSayContact': '请 @{name} 发言。',
  'meeting.userHostSayUser': '接下来由我发言。',
  'meeting.confirmAskSay':
    '请确认：{title}\n{prompt}\n选项：\n{options}\n请选择你认同的项，必要时给出评分。',
  'meeting.confirmAnswerSay': '确认 · {title}\n选择：{selected}\n评价：{comment}',
  'meeting.confirmNeedTwoOptions': '至少提供两个待确认选项',
  'meeting.confirmNotPending': '当前没有待确认事项',
  'meeting.confirmInvalidChoice': '请至少选择一个有效选项',
  'meeting.confirmPending': '请先完成待确认事项，再继续会议',
  'meeting.summarySystem':
    '你是会议主持人，正在做会后总结。会议目标：{goal}\n请用讨论所用语言写一份简洁总结：共识、分歧、已做决定、下一步。不要寒暄。可用 markdown 小标题。',
  'meeting.summaryUser': '结束原因：{reason}\n会议记录：\n{transcript}',
  'meeting.summaryFallback': '会议已结束。{reason}',
  'assemble.roomPersonality':
    '你是多 AI 聊天室中的「{name}」。请遵循以下人设：\n{prompt}',
  'assemble.roomQuote': '正在回复：「{quote}」\n\n{content}',
  'assemble.meetingSpeak':
    '会议目标：{goal}\n主持人请你发言。请结合你的专长发表看法，推动讨论向前。',
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
