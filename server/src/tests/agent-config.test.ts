/**
 * ★ API Token 共享（第 2 步）：**「这个智能体此刻该用哪把钥匙」的唯一答案。**
 *
 * 收口之前，`decrypt(agent.apiKey)` 那句话在 7 处各写了一遍 —— 那种复制的失败是**静默**的：
 * 漏改一处，表现是「某一条链路还在用旧 Token」，而没有任何东西会红。
 * 所以这一层值得逐条钉死：它是「一处改、多处生效」里那个「一处」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../services/crypto.js';
import { toAgentConfig, type AgentConfigRow } from '../services/agent-config.js';

const SHARED = 'pat_shared_aaaaaaaaaaaaaaaa';
const OWN = 'pat_own_bbbbbbbbbbbbbbbbbb';

/** 一份「自带旧钥匙」的 coze 智能体。 */
function agent(over: Partial<AgentConfigRow> = {}): AgentConfigRow {
  return {
    platform: 'coze',
    apiUrl: null,
    apiKey: encrypt(OWN),
    botId: '123',
    extra: null,
    credentialId: null,
    ...over,
  };
}

test('🔴 coze + 有共享凭据 ⇒ 用共享那把，**不是**自带的', () => {
  const config = toAgentConfig(agent({ credentialId: 'cred-1' }), { token: encrypt(SHARED) });
  assert.equal(config.apiKey, SHARED);
  // 阳性对照：自带那把确实读得出来（否则「用共享的」这句在「两把都读不出来」时也成立）
  assert.equal(toAgentConfig(agent(), null).apiKey, OWN);
});

test('🔴 没有共享凭据（credentialId 为空）⇒ 用自带的 —— 这是老数据与回滚的路', () => {
  assert.equal(toAgentConfig(agent(), null).apiKey, OWN);
  assert.equal(toAgentConfig(agent(), undefined).apiKey, OWN);
  // ⚠️ credentialId 有值、但凭据**读不到**（悬空引用 / 换过密钥）⇒ 也回落，不抛
  assert.equal(toAgentConfig(agent({ credentialId: 'cred-1' }), null).apiKey, OWN, '悬空引用必须回落，不能把整条链路炸掉');
});

test('🔴 非 coze 的智能体**绝不**走共享那条路（哪怕它挂着 credentialId）', () => {
  // 判据里带 `platform` 就是为了这一条：少了它，将来给别的平台误挂一份凭据时，
  // 那个智能体会**静默地换钥匙** —— 而 coze-agent / 文心 / 智谱的凭据是不是账号级的，
  // 我们没有证据（spec §目标：今天只接 coze）。
  for (const platform of ['coze-agent', 'wenxin', 'zhipuai']) {
    assert.equal(
      toAgentConfig(agent({ platform, credentialId: 'cred-1' }), { token: encrypt(SHARED) }).apiKey,
      OWN,
      `${platform} 不该用 coze 的共享凭据`,
    );
  }
});

test('老库里存过**未加密**的钥匙 ⇒ 原样用，不抛', () => {
  assert.equal(toAgentConfig(agent({ apiKey: 'plain-old-key' }), null).apiKey, 'plain-old-key');
  // 密文坏掉（换过密钥 / 手改过）⇒ 还是原样用，与改动前那 7 处的 try/catch 逐字一致
  assert.equal(toAgentConfig(agent({ apiKey: 'deadbeef:deadbeef:deadbeef' }), null).apiKey, 'deadbeef:deadbeef:deadbeef');
  // 共享那份坏掉 ⇒ 回落自带，而不是拿一串坏密文去请求平台
  assert.equal(toAgentConfig(agent({ credentialId: 'c' }), { token: 'deadbeef:deadbeef:deadbeef' }).apiKey, OWN);
});

test('其余字段照旧搬运（可空的一律 undefined）', () => {
  const full = toAgentConfig(agent({ apiUrl: 'https://x', extra: '{"a":1}' }), null);
  assert.equal(full.apiUrl, 'https://x');
  assert.equal(full.botId, '123');
  assert.equal(full.extra, '{"a":1}');
  assert.equal(full.platform, 'coze');

  const bare = toAgentConfig(agent({ apiUrl: null, botId: null, extra: null }), null);
  assert.equal(bare.apiUrl, undefined);
  assert.equal(bare.botId, undefined);
  assert.equal(bare.extra, undefined);
  // ⚠️ 是 `undefined` 而不是空串：下游有 `if (config.apiUrl)` 这类判据，
  //    空串是 truthy —— 会把「没配 URL」当成「配了一个空 URL」。
  assert.equal('conversationId' in bare, false, '没给就不该出现这个键');
});

test('conversationId 传了才带上（只有对话那一条链路需要上下文延续）', () => {
  assert.equal(toAgentConfig(agent(), null, { conversationId: 'conv-9' }).conversationId, 'conv-9');
  assert.equal(toAgentConfig(agent(), null, {}).conversationId, undefined);
  assert.equal(toAgentConfig(agent(), null).conversationId, undefined);
});
