/** Keep upstream diagnostics in teacher logs; send only actionable copy to students. */
export function studentAIErrorMessage(error: string | undefined, fileUrls: string[] = []): string {
  const detail = error || '';
  const code = Number(detail.match(/(?:code\s*[=:]\s*|HTTP\s+)(\d+)/i)?.[1]);
  const audio = fileUrls.some(url => /\.ogg$/i.test(url));
  if (audio && /未识别到(?:有效)?(?:语音|人声|文字)|没有识别到(?:有效)?(?:语音|人声|文字)|识别结果为空|no (?:valid )?speech|empty transcription|asr[^\n]{0,80}(?:empty|no speech)/i.test(detail)) {
    return '没有听清你说的话，请靠近一点，再说一次。';
  }
  if (code === 4016) return '小助手正在回答上一条消息，请稍等一会儿。';
  if ([401, 403, 4006, 4011, 4012, 4015, 4019, 4021, 4022, 4028, 4100, 4101].includes(code)
    || /unauthorized|invalid (?:api[ -]?key|access token)|access token invalid/i.test(detail)) {
    return '小助手暂时无法使用，请告诉老师。';
  }
  if ([429, 4008, 4009, 4020].includes(code) || /rate.?limit|too many requests|请求过于频繁/i.test(detail)) {
    return '小助手有点忙，请稍等一会儿再试。';
  }
  if (code === 4010) return '这次内容有点多，请简短一些再试。';
  if (code === 4014) return '小助手暂时答不了这个问题，换个说法试试。';
  if (code === 4302) return audio ? '录音文件有点大，请分成几段发送。' : '文件有点大，请缩小后再发送。';
  if ([4300, 4303, 4304].includes(code)) return audio ? '这段录音暂时无法读取，请重新录一段。' : '这份文件暂时无法读取，请换一份再试。';
  if (/timeout|timed out|超时/i.test(detail)) return '等待回复的时间有点长，请稍后再试。';
  if (/fetch failed|network error|网络连接|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(detail)) {
    return '连接暂时不稳定，请稍后再试。';
  }
  return audio
    ? '这次语音没能处理成功，请再说一次，或改用文字发送。'
    : '小助手暂时没能回复，请稍后再试。';
}
