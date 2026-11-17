import { initDb, closeDb } from '../src/db/index.js';
import UserService from '../src/services/UserService.js';
import ApiKeyService from '../src/services/ApiKeyService.js';
import SettingsService from '../src/services/SettingsService.js';
import MessageService from '../src/services/MessageService.js';
import ContactService from '../src/services/ContactService.js';
import SchedulerService from '../src/services/SchedulerService.js';
import { createHash } from 'crypto';

let user;

beforeAll(async () => {
  await initDb(':memory:');
  user = await UserService.create({ name: 'A', email: ' A@X.io ', password: 'secret' });
});

afterAll(() => closeDb());

describe('UserService', () => {
  it('normalizes email, hashes password and hides it', async () => {
    expect(user.email).toBe('a@x.io');
    expect(user.password).toBeUndefined();
    expect(user.role).toBe('user');
    expect(user.createdAt).toBeInstanceOf(Date);
    const full = UserService.findByEmail('A@x.io');
    expect(await UserService.comparePassword(full, 'secret')).toBe(true);
  });

  it('only rehashes the password when a new one is given', async () => {
    await UserService.update(user.id, { name: 'B', password: '' });
    expect(await UserService.comparePassword(UserService.findById(user.id), 'secret')).toBe(true);
    await UserService.update(user.id, { password: 'new' });
    expect(await UserService.comparePassword(UserService.findById(user.id), 'new')).toBe(true);
  });

  it('enforces unique email', async () => {
    await expect(UserService.create({ name: 'C', email: 'a@x.io', password: 'x' })).rejects.toThrow(/UNIQUE/);
  });

  it('tracks linked WhatsApp sessions', () => {
    UserService.setWaSession(user.id, user.id);
    expect(UserService.listLinkedSessionIds()).toEqual([user.id]);
    UserService.setWaSession(user.id, null);
    expect(UserService.listLinkedSessionIds()).toEqual([]);
  });
});

describe('ApiKeyService', () => {
  it('generates, resolves and deletes keys', async () => {
    const key = await ApiKeyService.generateApiKey(user.id);
    const hash = createHash('sha256').update(key.raw_key).digest('hex');
    expect(ApiKeyService.findUserIdByKeyHash(hash)).toBe(user.id);
    expect(await ApiKeyService.getUserApiKeys(user.id)).toHaveLength(1);
    await ApiKeyService.deleteApiKey(user.id, key.id);
    expect(ApiKeyService.findUserIdByKeyHash(hash)).toBeNull();
  });
});

describe('SettingsService', () => {
  it('upserts settings', async () => {
    await SettingsService.set('webhook_url', 'http://a');
    await SettingsService.set('webhook_url', 'http://b');
    const map = await SettingsService.getMany(['webhook_url', 'missing']);
    expect(map.get('webhook_url')).toBe('http://b');
    expect(await SettingsService.getSettings()).toEqual({ webhook_url: 'http://b' });
  });

  it('adds, toggles and deletes auto-replies', async () => {
    await SettingsService.addAutoReply('hi', 'hello');
    const [rule] = await SettingsService.getAutoReplies();
    expect(rule.enabled).toBe(true);
    await SettingsService.toggleAutoReply(rule.id);
    expect(await SettingsService.getEnabledAutoReplies()).toHaveLength(0);
    await SettingsService.toggleAutoReply(rule.id);
    expect(await SettingsService.getEnabledAutoReplies()).toHaveLength(1);
    await SettingsService.deleteAutoReply(rule.id);
    expect(await SettingsService.getAutoReplies()).toHaveLength(0);
  });
});

describe('MessageService', () => {
  beforeAll(async () => {
    for (const [chatJid, t, text] of [['a', 1000, 'a1'], ['b', 2000, 'b1'], ['a', 3000, 'a2']]) {
      await MessageService.recordMessage({
        userId: user.id, chatJid, sender: 's', text, direction: 'in', timestamp: t,
        stanzaId: text, attachment: { kind: 'x' }
      });
    }
  });

  it('returns the latest message per chat', async () => {
    const chats = await MessageService.getChats(user.id);
    expect(chats.map(c => c.message)).toEqual(['a2', 'b1']);
    expect(chats[0].timestamp).toBeInstanceOf(Date);
  });

  it('paginates chat messages oldest-first', async () => {
    const all = await MessageService.getChatMessages(user.id, 'a');
    expect(all.map(m => m.message)).toEqual(['a1', 'a2']);
    const before = await MessageService.getChatMessages(user.id, 'a', { before: new Date(3000) });
    expect(before.map(m => m.message)).toEqual(['a1']);
  });

  it('finds by stanza id and id, scoped to the user', () => {
    const msg = MessageService.findByStanzaId(user.id, 'b1');
    expect(msg.attachment).toEqual({ kind: 'x' });
    expect(MessageService.findById(user.id, msg.id).stanzaId).toBe('b1');
    expect(MessageService.findById('someone-else', msg.id)).toBeNull();
  });
});

describe('ContactService', () => {
  it('paginates, dedupes on import and updates tags', async () => {
    const res = await ContactService.insertUniqueContacts(user.id, [
      { name: 'Z', phone: '1' }, { name: 'Y', phone: '2' }, { name: 'Y2', phone: '2' }
    ]);
    expect(res).toEqual({ imported: 2, duplicates: 1, total: 3 });
    const again = await ContactService.insertUniqueContacts(user.id, [{ name: 'Z', phone: '1' }]);
    expect(again.imported).toBe(0);

    const page = await ContactService.getContacts(user.id, 1);
    expect(page.total).toBe(2);
    expect(page.contacts.map(c => c.name)).toEqual(['Y', 'Z']);

    await ContactService.updateTags(user.id, page.contacts[0].id, 'vip');
    expect((await ContactService.getAllContacts(user.id))[0].tags).toBe('vip');
  });
});

describe('SchedulerService', () => {
  const sent = [];
  const scheduler = new SchedulerService({
    sendMessage: async (userId, to, message) => { sent.push({ userId, to, message }); return { id: 'WAMSG1' }; }
  });

  it('sends due messages and records the result', async () => {
    const due = await scheduler.createScheduledMessage(user.id, { to: '62', message: 'now', scheduledAt: Date.now() - 1000 });
    await scheduler.createScheduledMessage(user.id, { to: '62', message: 'later', scheduledAt: Date.now() + 3600e3 });

    await scheduler.processPendingMessages();
    expect(sent).toEqual([{ userId: user.id, to: '62', message: 'now' }]);

    const [row] = await scheduler.getUserScheduledMessages(user.id, { status: 'sent' });
    expect(row.id).toBe(due.id);
    expect(row.messageId).toBe('WAMSG1');
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it('cancels, deletes and counts', async () => {
    const [pending] = await scheduler.getUserScheduledMessages(user.id, { status: 'pending' });
    await scheduler.cancelScheduledMessage(user.id, pending.id);
    await expect(scheduler.cancelScheduledMessage(user.id, pending.id)).rejects.toThrow();
    expect(await scheduler.getStatistics(user.id)).toEqual({ total: 2, pending: 0, sent: 1, failed: 0, cancelled: 1 });
    await scheduler.deleteScheduledMessage(user.id, pending.id);
    expect((await scheduler.getStatistics(user.id)).total).toBe(1);
  });
});

describe('cascade', () => {
  it('deletes a user together with their data', async () => {
    UserService.delete(user.id);
    expect(await ContactService.getAllContacts(user.id)).toHaveLength(0);
    expect(await MessageService.getChats(user.id)).toHaveLength(0);
    expect((await new SchedulerService(null).getStatistics(user.id)).total).toBe(0);
  });
});
