import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlarmClock,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Flame,
  GlassWater,
  Loader2,
  MapPin,
  MessageCircleMore,
  Music4,
  Send,
  ShieldAlert,
  Sparkles,
  TicketCheck,
  UserRoundCheck,
  UsersRound,
  Wine,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';

const API_BASE = process.env.REACT_APP_API_BASE_URL || '';
const ALLOW_DEMO_FALLBACK =
  process.env.REACT_APP_ENABLE_DEMO_FALLBACK === 'true';

type UiMode = 'amber' | 'velvet';
type Screen = 'create' | 'detail';
type RSVPResponse = 'going' | 'maybe' | 'cancelled';
type ReviewAction = 'approve' | 'waitlist' | 'reject';

interface Host {
  id: string;
  nickname: string;
  avatar: string;
}

interface Invite {
  id: string;
  share_id: string;
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  vibe: string;
  message: string;
  capacity: number;
  aa_rule: string;
  house_rules: string;
  review_required: boolean;
  adults_only: boolean;
  public_share: boolean;
  status: 'open' | 'ongoing' | 'ended' | 'cancelled';
  cover_style: UiMode;
  created_at: string;
  updated_at?: string | null;
  viewer_is_host: boolean;
  host: Host;
  counts: {
    approved_going: number;
    approved_maybe: number;
    pending: number;
    waitlist: number;
    rejected: number;
    cancelled: number;
    total: number;
  };
  rsvps: Array<{
    id: string;
    visitor_id: string;
    nickname: string;
    response: RSVPResponse;
    status: 'approved' | 'pending' | 'waitlist' | 'rejected' | 'cancelled';
    note: string;
    updated_at: string;
  }>;
  reminders: Array<{
    id: string;
    label: string;
    scheduled_at: string;
    status: string;
  }>;
  notifications: Array<{
    id: string;
    kind: string;
    audience: string;
    title: string;
    body: string;
    created_at: string;
  }>;
}

interface DailyGame {
  id: string;
  title: string;
  tag: string;
  fit: string;
  jump_type: 'h5' | 'internal';
  url: string;
  description: string;
  source: string;
  rank: number;
}

const themeCopy: Record<
  UiMode,
  { name: string; label: string; mood: string; accent: string }
> = {
  amber: {
    name: '方案 A · Amber Soirée',
    label: '酒单邀请感',
    mood: '像一张高级小酒馆邀请函，暖光、纸感、朋友局。',
    accent: '适合偏精致、偏温暖的熟人组局。',
  },
  velvet: {
    name: '方案 B · Velvet Lounge',
    label: '夜色微醺感',
    mood: '更偏夜晚 lounge 气质，深色、玻璃、局中互动更强。',
    accent: '适合偏夜场、偏氛围型的酒局产品呈现。',
  },
};

const vibeOptions = ['微醺聊天', '认真品酒', '庆祝一下', '轻松破冰'];
const reportTypes = [
  { value: 'invite', label: '酒局信息' },
  { value: 'game', label: '内置题目' },
  { value: 'external_game', label: '扩展推荐' },
] as const;

const builtInGames = [
  {
    id: 'truth',
    badge: '破冰',
    title: '真心话 / 大冒险',
    summary: '熟人和半熟人都适合，适合开场 10 分钟后使用。',
    prompts: [
      '讲一个你最近想说但一直没说出口的小念头。',
      '把你手机里最近一首循环最多的歌讲讲为什么。',
      '选择一位朋友，夸他一个你平时不会当面夸的点。',
      '给在场的人出一道“只能选一个”的有趣问题。',
    ],
  },
  {
    id: 'never',
    badge: '暖场',
    title: '我从没',
    summary: '节奏平稳，适合不想太刺激、但又怕冷场的局。',
    prompts: [
      '我从没在凌晨两点后还和朋友聊得很投入。',
      '我从没因为某个朋友的一句话突然想喝酒。',
      '我从没在聚会上临时决定去第二场。',
      '我从没把酒局当成认真聊天的正式场合。',
    ],
  },
  {
    id: 'drinkif',
    badge: '轻惩罚',
    title: 'Drink If',
    summary: '默认支持跳过和替代惩罚，不把气氛做成压力。',
    prompts: [
      '如果你最近一个月想过辞职，就轻碰一下杯。',
      '如果你会因为一句消息开心半天，就拿起杯子示意一下。',
      '如果你曾经因为一首歌突然想起某个朋友，就点头。',
      '如果你更喜欢小范围酒局而不是大场子，就来一口。',
    ],
  },
  {
    id: 'duel',
    badge: '双人',
    title: '双人对决',
    summary: '适合 2 人快速互动，也可以围观起哄。',
    prompts: [
      '你们两个人各用 15 秒，推荐今晚最适合继续待着的理由。',
      '互相给对方起一个今晚的酒局代号。',
      '轮流用一句话讲“我为什么适合这一桌”。',
      '互相提一个“下次再约时必须兑现”的小约定。',
    ],
  },
];

function apiUrl(path: string) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function getApiErrorMessage(payload: unknown, status: number) {
  const fallback =
    status >= 500 ? '服务暂时不可用，请稍后再试' : '提交失败，请检查填写内容';
  if (!payload || typeof payload !== 'object') return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return fallback;

  const fieldNames: Record<string, string> = {
    title: '酒局标题',
    event_date: '日期',
    event_time: '时间',
    venue: '地点',
    capacity: '人数上限',
    aa_rule: 'AA 规则',
    house_rules: '局前规则',
    nickname: '昵称',
  };
  const messages = detail.map(item => {
    if (!item || typeof item !== 'object') return '';
    const issue = item as { loc?: unknown[]; msg?: string };
    const field = String(issue.loc?.[issue.loc.length - 1] || '内容');
    const label = fieldNames[field] || field;
    const message = issue.msg || '填写不正确';
    if (message.includes('at least 1 characters')) return `${label}不能为空`;
    if (message.includes('field required')) return `请填写${label}`;
    if (message.includes('valid integer')) return `${label}需要填写数字`;
    return `${label}：${message}`;
  });
  return messages.filter(Boolean).join('；') || fallback;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  };

  if (API_BASE) {
    try {
      const response = await fetch(apiUrl(path), fetchOptions);
      const payload = await response
        .json()
        .catch(() => ({ detail: '请求失败' }));
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, response.status));
      }
      return payload as T;
    } catch (error) {
      if (ALLOW_DEMO_FALLBACK && typeof window !== 'undefined') {
        return mockRequest<T>(path, fetchOptions);
      }
      throw error;
    }
  }

  if (ALLOW_DEMO_FALLBACK) {
    return mockRequest<T>(path, fetchOptions);
  }
  throw new Error('服务地址未配置，请稍后再试');
}

function formatDate(date: string, time?: string) {
  if (!date) return '未设置';
  const parsed = new Date(`${date}T${time || '00:00:00'}`);
  if (Number.isNaN(parsed.getTime())) return `${date}${time ? ` ${time}` : ''}`;
  return parsed.toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: time ? '2-digit' : undefined,
    minute: time ? '2-digit' : undefined,
  });
}

function formatTime(isoText: string) {
  if (!isoText) return '-';
  const parsed = new Date(isoText);
  if (Number.isNaN(parsed.getTime())) return isoText;
  return parsed.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MiniAvatar({ text }: { text: string }) {
  return <span className="mini-avatar">{text.slice(0, 1)}</span>;
}

function statusCopy(status: Invite['status']) {
  const map: Record<Invite['status'], string> = {
    open: '报名中',
    ongoing: '进行中',
    ended: '已结束',
    cancelled: '已取消',
  };
  return map[status];
}

interface DemoStore {
  hosts: Array<Host & { token: string }>;
  invites: Invite[];
}

const DEMO_STORE_KEY = 'drink-demo-store-v3';
const demoGameSeeds: Omit<DailyGame, 'rank'>[] = [
  {
    id: 'truth-or-drink',
    title: 'Truth or Drink 在线局',
    tag: '双人破冰',
    fit: '适合熟人暖场',
    jump_type: 'h5',
    url: 'https://truthordrink.app/',
    description: '问题强度适中，适合两三个人轮流接招。',
    source: '精选 H5',
  },
  {
    id: 'gartic-phone',
    title: 'Gartic Phone 画画传话',
    tag: '多人轻对抗',
    fit: '适合 4-8 人',
    jump_type: 'h5',
    url: 'https://garticphone.com/zh-CN',
    description: '更适合后半场，酒桌围观感强。',
    source: '白名单站点',
  },
  {
    id: 'aftertaste',
    title: 'Aftertaste 酒桌快问',
    tag: '今晚精选',
    fit: '适合 2-6 人',
    jump_type: 'internal',
    url: '/?game=aftertaste',
    description: '偏朋友间的快问快答，节奏轻，不压迫。',
    source: '内置扩展',
  },
  {
    id: 'playlist-battle',
    title: 'Playlist Battle 歌单对决',
    tag: '轻剧情',
    fit: '适合熟人局',
    jump_type: 'internal',
    url: '/?game=playlist-battle',
    description: '每人出一首歌配一个故事，更适合聊天局。',
    source: '内置扩展',
  },
];

function getHeaders(headers?: HeadersInit) {
  return new Headers(headers || {});
}

function nowIso() {
  return new Date().toISOString();
}

function readDemoStore(): DemoStore {
  if (typeof window === 'undefined') {
    return { hosts: [], invites: [] };
  }
  const raw = window.localStorage.getItem(DEMO_STORE_KEY);
  if (!raw) return { hosts: [], invites: [] };
  try {
    return JSON.parse(raw) as DemoStore;
  } catch {
    return { hosts: [], invites: [] };
  }
}

function writeDemoStore(store: DemoStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
}

function countByStatus(invite: Invite) {
  const counts = {
    approved_going: 0,
    approved_maybe: 0,
    pending: 0,
    waitlist: 0,
    rejected: 0,
    cancelled: 0,
    total: invite.rsvps.length,
  };
  invite.rsvps.forEach(item => {
    if (item.status === 'approved' && item.response === 'going')
      counts.approved_going += 1;
    else if (item.status === 'approved' && item.response === 'maybe')
      counts.approved_maybe += 1;
    else if (item.status === 'pending') counts.pending += 1;
    else if (item.status === 'waitlist') counts.waitlist += 1;
    else if (item.status === 'rejected') counts.rejected += 1;
    else if (item.status === 'cancelled') counts.cancelled += 1;
  });
  return counts;
}

function withViewer(invite: Invite, token?: string | null) {
  const next = JSON.parse(JSON.stringify(invite)) as Invite;
  const host = token
    ? readDemoStore().hosts.find(item => item.token === token)
    : undefined;
  next.viewer_is_host = Boolean(host && host.id === next.host.id);
  next.counts = countByStatus(next);
  next.notifications = [...next.notifications].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  next.reminders = [...next.reminders].sort((a, b) =>
    a.scheduled_at.localeCompare(b.scheduled_at),
  );
  return next;
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildDemoReminders(eventDate: string, eventTime: string) {
  const event = new Date(`${eventDate}T${eventTime}:00`);
  const candidates = [
    { label: 'T-1 天提醒', delta: 24 * 60 * 60 * 1000 },
    { label: 'T-2 小时提醒', delta: 2 * 60 * 60 * 1000 },
    { label: 'T-30 分钟提醒', delta: 30 * 60 * 1000 },
  ];
  return candidates
    .map(item => ({
      id: makeId('remind'),
      label: item.label,
      scheduled_at: new Date(event.getTime() - item.delta).toISOString(),
      status: 'scheduled',
    }))
    .filter(item => item.scheduled_at > nowIso())
    .slice(0, event.getTime() - Date.now() > 12 * 60 * 60 * 1000 ? 2 : 2);
}

function buildDemoGames() {
  const offset = new Date().getDate() % demoGameSeeds.length;
  return demoGameSeeds.map((item, index) => ({
    ...demoGameSeeds[(offset + index) % demoGameSeeds.length],
    rank: index + 1,
  }));
}

function createNotification(
  invite: Invite,
  kind: string,
  audience: string,
  title: string,
  body: string,
) {
  invite.notifications.unshift({
    id: makeId('note'),
    kind,
    audience,
    title,
    body,
    created_at: nowIso(),
  });
}

function promoteWaitlist(invite: Invite) {
  const approvedGoing = invite.rsvps.filter(
    item => item.status === 'approved' && item.response === 'going',
  ).length;
  if (approvedGoing >= invite.capacity) return;
  const waitlist = invite.rsvps.find(
    item => item.status === 'waitlist' && item.response === 'going',
  );
  if (!waitlist) return;
  waitlist.status = invite.review_required ? 'pending' : 'approved';
  waitlist.updated_at = nowIso();
  createNotification(
    invite,
    'waitlist_promoted',
    'guest',
    '候补有空位了',
    `${waitlist.nickname} 已从候补更新为${invite.review_required ? '待确认' : '已通过'}。`,
  );
}

function computeRsvpStatus(
  invite: Invite,
  response: RSVPResponse,
  currentId?: string,
) {
  if (response === 'cancelled') return 'cancelled' as const;
  if (invite.status !== 'open') throw new Error('当前酒局已关闭报名');
  const approvedGoing = invite.rsvps.filter(
    item =>
      item.id !== currentId &&
      item.status === 'approved' &&
      item.response === 'going',
  ).length;
  if (response === 'going' && approvedGoing >= invite.capacity)
    return 'waitlist' as const;
  return invite.review_required ? ('pending' as const) : ('approved' as const);
}

async function mockRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const store = readDemoStore();
  const headers = getHeaders(options?.headers);
  const token = headers.get('x-host-token');
  const method = (options?.method || 'GET').toUpperCase();
  const body = options?.body ? JSON.parse(String(options.body)) : undefined;

  if (path === '/auth/wechat/demo' && method === 'POST') {
    const host = {
      id: makeId('host'),
      nickname: body.nickname,
      avatar: '',
      token: makeId('token'),
    };
    store.hosts.unshift(host);
    writeDemoStore(store);
    return {
      host_token: host.token,
      host: { id: host.id, nickname: host.nickname, avatar: host.avatar },
    } as T;
  }

  if (path === '/games/daily' && method === 'GET') {
    return {
      date: new Date().toISOString().slice(0, 10),
      items: buildDemoGames(),
    } as T;
  }

  if (path === '/invites' && method === 'POST') {
    const host = store.hosts.find(item => item.token === token);
    if (!host) throw new Error('请先确认发起人身份');
    const invite: Invite = {
      id: makeId('invite'),
      share_id: makeId('share').replace('share_', ''),
      title: body.title,
      event_date: body.event_date,
      event_time: body.event_time,
      venue: body.venue,
      vibe: body.vibe,
      message: body.message,
      capacity: body.capacity,
      aa_rule: body.aa_rule,
      house_rules: body.house_rules,
      review_required: body.review_required,
      adults_only: body.adults_only,
      public_share: body.public_share,
      status: 'open',
      cover_style: body.cover_style,
      created_at: nowIso(),
      updated_at: nowIso(),
      viewer_is_host: true,
      host: { id: host.id, nickname: host.nickname, avatar: host.avatar },
      counts: {
        approved_going: 0,
        approved_maybe: 0,
        pending: 0,
        waitlist: 0,
        rejected: 0,
        cancelled: 0,
        total: 0,
      },
      rsvps: [],
      reminders: buildDemoReminders(body.event_date, body.event_time),
      notifications: [],
    };
    createNotification(
      invite,
      'invite_created',
      'host',
      '酒局已创建',
      `${invite.title} 已生成分享卡，可以直接发出去。`,
    );
    store.invites.unshift(invite);
    writeDemoStore(store);
    return withViewer(invite, token) as T;
  }

  if (path.startsWith('/invites/') && method === 'GET') {
    const shareId = path.replace('/invites/', '');
    const invite = store.invites.find(item => item.share_id === shareId);
    if (!invite) throw new Error('这张邀请卡已经找不到了');
    return withViewer(invite, token) as T;
  }

  if (
    path.startsWith('/invites/') &&
    path.endsWith('/rsvp') &&
    method === 'POST'
  ) {
    const shareId = path.replace('/invites/', '').replace('/rsvp', '');
    const invite = store.invites.find(item => item.share_id === shareId);
    if (!invite) throw new Error('邀请卡不存在');
    const visitorId = body.visitor_id || makeId('visitor');
    const existing = invite.rsvps.find(item => item.visitor_id === visitorId);
    const status = computeRsvpStatus(invite, body.response, existing?.id);
    if (existing) {
      const wasApprovedGoing =
        existing.status === 'approved' && existing.response === 'going';
      existing.nickname = body.nickname;
      existing.response = body.response;
      existing.status = status;
      existing.note = body.note;
      existing.updated_at = nowIso();
      if (wasApprovedGoing && body.response === 'cancelled')
        promoteWaitlist(invite);
    } else {
      invite.rsvps.unshift({
        id: makeId('rsvp'),
        visitor_id: visitorId,
        nickname: body.nickname,
        response: body.response,
        status,
        note: body.note,
        updated_at: nowIso(),
      });
    }
    createNotification(
      invite,
      'rsvp_updated',
      'host',
      '报名状态有更新',
      `${body.nickname} 提交了 ${body.response}，当前状态为 ${status}。`,
    );
    invite.updated_at = nowIso();
    writeDemoStore(store);
    return { visitor_id: visitorId, invite: withViewer(invite, token) } as T;
  }

  if (
    path.startsWith('/invites/') &&
    path.endsWith('/review') &&
    method === 'POST'
  ) {
    const inviteId = path.replace('/invites/', '').replace('/review', '');
    const host = store.hosts.find(item => item.token === token);
    const invite = store.invites.find(item => item.id === inviteId);
    if (!host || !invite) throw new Error('酒局不存在或身份无效');
    if (invite.host.id !== host.id) throw new Error('只有主理人能审核名单');
    const rsvp = invite.rsvps.find(item => item.id === body.rsvp_id);
    if (!rsvp) throw new Error('报名记录不存在');
    let nextStatus: Invite['rsvps'][number]['status'] = 'approved';
    if (body.action === 'approve') {
      nextStatus =
        computeRsvpStatus(invite, rsvp.response, rsvp.id) === 'waitlist'
          ? 'waitlist'
          : 'approved';
    } else if (body.action === 'waitlist') {
      nextStatus = 'waitlist';
    } else {
      nextStatus = 'rejected';
      promoteWaitlist(invite);
    }
    rsvp.status = nextStatus;
    rsvp.updated_at = nowIso();
    createNotification(
      invite,
      'review_decision',
      'guest',
      '主理人更新了你的状态',
      `${rsvp.nickname} 当前状态已更新为 ${nextStatus}。`,
    );
    invite.updated_at = nowIso();
    writeDemoStore(store);
    return withViewer(invite, token) as T;
  }

  if (path.startsWith('/invites/') && method === 'PATCH') {
    const inviteId = path.replace('/invites/', '');
    const host = store.hosts.find(item => item.token === token);
    const invite = store.invites.find(item => item.id === inviteId);
    if (!host || !invite) throw new Error('酒局不存在或身份无效');
    if (invite.host.id !== host.id) throw new Error('只有主理人能修改这场局');
    Object.assign(invite, body, { updated_at: nowIso() });
    if (body.status === 'cancelled') {
      createNotification(
        invite,
        'invite_cancelled',
        'all',
        '酒局已取消',
        `${invite.title} 已被主理人取消。`,
      );
    }
    if (body.status === 'ended') {
      createNotification(
        invite,
        'invite_ended',
        'all',
        '酒局已结束',
        `${invite.title} 已标记为结束，可直接复用模板再开一局。`,
      );
    }
    writeDemoStore(store);
    return withViewer(invite, token) as T;
  }

  if (
    path.startsWith('/invites/') &&
    path.endsWith('/report') &&
    method === 'POST'
  ) {
    const shareId = path.replace('/invites/', '').replace('/report', '');
    const invite = store.invites.find(item => item.share_id === shareId);
    if (!invite) throw new Error('邀请卡不存在');
    createNotification(
      invite,
      'report_created',
      'host',
      '有人提交了举报',
      `举报类型：${body.target_type}。`,
    );
    writeDemoStore(store);
    return { ok: true, message: '已收到举报，我们会尽快处理。' } as T;
  }

  throw new Error('当前演示模式暂未覆盖这个接口');
}

export default function Page() {
  const [mode, setMode] = useState<UiMode>('amber');
  const [screen, setScreen] = useState<Screen>('create');
  const [hostToken, setHostToken] = useState('');
  const [host, setHost] = useState<Host | null>(null);
  const [visitorId, setVisitorId] = useState('');
  const [authName, setAuthName] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [showShareGuide, setShowShareGuide] = useState(false);
  const [isWechat, setIsWechat] = useState(false);
  const [inviteShareId, setInviteShareId] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [dailyGames, setDailyGames] = useState<DailyGame[]>([]);
  const [jumpTarget, setJumpTarget] = useState<DailyGame | null>(null);
  const [gameCursor, setGameCursor] = useState<Record<string, number>>({});
  const [form, setForm] = useState({
    title: '周五微醺聊天局',
    event_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    event_time: '20:30',
    venue: '国贸 · Amber Room',
    vibe: '微醺聊天',
    message: '忙完这一周，找个舒服地方见面喝一杯，聊天、玩两轮小游戏就够。',
    capacity: 6,
    aa_rule: 'AA 预估 120-160 / 人',
    house_rules: '不灌酒，可跳过游戏，迟到提前说。',
    review_required: true,
    adults_only: true,
    public_share: true,
    cover_style: 'amber' as UiMode,
  });
  const [rsvpForm, setRsvpForm] = useState({
    nickname: '周末搭子',
    response: 'going' as RSVPResponse,
    note: '我能 20:45 前到，想先玩暖场局。',
  });
  const [reportForm, setReportForm] = useState({
    reporter_name: '匿名朋友',
    target_type: 'game' as 'invite' | 'game' | 'external_game',
    content: '题目过于冒犯，希望换一题。',
  });

  const currentRsvp = useMemo(
    () => invite?.rsvps.find(item => item.visitor_id === visitorId) || null,
    [invite, visitorId],
  );

  const groupedRsvps = useMemo(() => {
    const rows = invite?.rsvps || [];
    return {
      approvedGoing: rows.filter(
        item => item.status === 'approved' && item.response === 'going',
      ),
      approvedMaybe: rows.filter(
        item => item.status === 'approved' && item.response === 'maybe',
      ),
      pending: rows.filter(item => item.status === 'pending'),
      waitlist: rows.filter(item => item.status === 'waitlist'),
      rejected: rows.filter(item => item.status === 'rejected'),
    };
  }, [invite]);

  const previewInvite = useMemo(() => {
    if (invite) return invite;
    return {
      title: form.title,
      event_date: form.event_date,
      event_time: form.event_time,
      venue: form.venue,
      vibe: form.vibe,
      message: form.message,
      aa_rule: form.aa_rule,
      capacity: form.capacity,
      house_rules: form.house_rules,
      review_required: form.review_required,
      adults_only: form.adults_only,
      public_share: form.public_share,
      host: host || { id: '', nickname: authName || '主理人', avatar: '' },
      counts: {
        approved_going: 3,
        approved_maybe: 1,
        pending: 2,
        waitlist: 1,
        rejected: 0,
        cancelled: 0,
        total: 7,
      },
      status: 'open' as Invite['status'],
    };
  }, [invite, form, host, authName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setIsWechat(/MicroMessenger/i.test(window.navigator.userAgent));
    const themeParam = params.get('ui');
    const inviteParam = params.get('invite');
    const localMode = window.localStorage.getItem(
      'drink-ui-mode',
    ) as UiMode | null;
    const nextMode =
      themeParam === 'velvet' || themeParam === 'amber'
        ? themeParam
        : localMode || 'amber';
    setMode(nextMode);
    setForm(prev => ({ ...prev, cover_style: nextMode }));
    if (inviteParam) {
      setInviteShareId(inviteParam);
      setScreen('detail');
    }
    const token = window.localStorage.getItem('drink-host-token') || '';
    const hostRaw = window.localStorage.getItem('drink-host');
    if (token) setHostToken(token);
    if (hostRaw) {
      try {
        setHost(JSON.parse(hostRaw) as Host);
      } catch {
        window.localStorage.removeItem('drink-host');
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('drink-ui-mode', mode);
    const params = new URLSearchParams(window.location.search);
    params.set('ui', mode);
    if (inviteShareId) params.set('invite', inviteShareId);
    const query = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
    setForm(prev => ({ ...prev, cover_style: mode }));
  }, [mode, inviteShareId]);

  useEffect(() => {
    request<{ date: string; items: DailyGame[] }>('/games/daily')
      .then(data => setDailyGames(data.items))
      .catch(error => toast.error((error as Error).message));
  }, []);

  useEffect(() => {
    const title = invite
      ? `${invite.title}｜喝一杯吗`
      : '喝一杯吗｜朋友间轻组局';
    const description = invite
      ? `${formatDate(invite.event_date, invite.event_time)} · ${invite.venue} · ${invite.aa_rule}`
      : '发起一场周末酒局，分享给微信好友并收集报名。';
    document.title = title;
    const setMeta = (selector: string, attribute: string, value: string) => {
      let node = document.head.querySelector<HTMLMetaElement>(selector);
      if (!node) {
        node = document.createElement('meta');
        const [key, name] = selector.includes('property=')
          ? ['property', selector.match(/property="([^"]+)"/)?.[1] || '']
          : ['name', selector.match(/name="([^"]+)"/)?.[1] || ''];
        node.setAttribute(key, name);
        document.head.appendChild(node);
      }
      node.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:type"]', 'content', 'website');
    setMeta(
      'meta[property="og:url"]',
      'content',
      typeof window === 'undefined' ? '' : window.location.href,
    );
  }, [invite]);

  useEffect(() => {
    if (!inviteShareId) return;
    fetchInvite(inviteShareId);
  }, [inviteShareId, hostToken]);

  async function fetchInvite(shareId: string) {
    setBusyKey('invite');
    try {
      const localVisitor =
        typeof window === 'undefined'
          ? ''
          : window.localStorage.getItem(`drink-visitor-${shareId}`) || '';
      const headers: Record<string, string> = {};
      if (hostToken) headers['x-host-token'] = hostToken;
      if (localVisitor) headers['x-visitor-id'] = localVisitor;
      const data = await request<Invite>(`/invites/${shareId}`, {
        headers,
      });
      setInvite(data);
      setScreen('detail');
      if (localVisitor) setVisitorId(localVisitor);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  async function login() {
    if (!authName.trim()) {
      toast.error('先写一个主理人昵称');
      return;
    }
    setBusyKey('login');
    try {
      const data = await request<{ host_token: string; host: Host }>(
        '/auth/host',
        {
          method: 'POST',
          body: JSON.stringify({ nickname: authName.trim() }),
        },
      );
      setHostToken(data.host_token);
      setHost(data.host);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('drink-host-token', data.host_token);
        window.localStorage.setItem('drink-host', JSON.stringify(data.host));
      }
      setShowLogin(false);
      toast.success('主理人身份已确认');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  async function createInvite() {
    if (!hostToken) {
      setShowLogin(true);
      return;
    }
    const requiredFields = [
      [form.title.trim(), '请填写酒局标题'],
      [form.event_date, '请选择日期'],
      [form.event_time, '请选择时间'],
      [form.venue.trim(), '请填写地点'],
      [form.aa_rule.trim(), '请填写 AA 规则'],
    ];
    const invalidField = requiredFields.find(([value]) => !value);
    if (invalidField) {
      toast.error(invalidField[1]);
      return;
    }
    setBusyKey('create');
    try {
      const data = await request<Invite>('/invites', {
        method: 'POST',
        headers: { 'x-host-token': hostToken },
        body: JSON.stringify({ ...form, cover_style: mode }),
      });
      setInvite(data);
      setInviteShareId(data.share_id);
      setScreen('detail');
      toast.success('新酒局已经做好，可以直接分享');
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('主理人身份')) {
        setHostToken('');
        setHost(null);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('drink-host-token');
          window.localStorage.removeItem('drink-host');
        }
        setShowLogin(true);
      }
      toast.error(message);
    } finally {
      setBusyKey('');
    }
  }

  async function submitRsvp(response: RSVPResponse) {
    if (!invite) return;
    setBusyKey(`rsvp-${response}`);
    try {
      const data = await request<{ visitor_id: string; invite: Invite }>(
        `/invites/${invite.share_id}/rsvp`,
        {
          method: 'POST',
          body: JSON.stringify({
            nickname: rsvpForm.nickname,
            response,
            note: rsvpForm.note,
            visitor_id: visitorId || undefined,
          }),
        },
      );
      setVisitorId(data.visitor_id);
      setInvite(data.invite);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          `drink-visitor-${invite.share_id}`,
          data.visitor_id,
        );
      }
      toast.success(response === 'cancelled' ? '已撤回报名' : '回应已送达');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  async function reviewRsvp(rsvpId: string, action: ReviewAction) {
    if (!invite) return;
    setBusyKey(`${action}-${rsvpId}`);
    try {
      const data = await request<Invite>(`/invites/${invite.id}/review`, {
        method: 'POST',
        headers: { 'x-host-token': hostToken },
        body: JSON.stringify({ rsvp_id: rsvpId, action }),
      });
      setInvite(data);
      toast.success('名单状态已更新');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  async function updateInviteStatus(status: Invite['status']) {
    if (!invite) return;
    setBusyKey(`status-${status}`);
    try {
      const data = await request<Invite>(`/invites/${invite.id}`, {
        method: 'PATCH',
        headers: { 'x-host-token': hostToken },
        body: JSON.stringify({ status }),
      });
      setInvite(data);
      toast.success(`酒局已更新为${statusCopy(status)}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  async function reportIssue() {
    if (!invite) return;
    setBusyKey('report');
    try {
      await request<{ ok: boolean; message: string }>(
        `/invites/${invite.share_id}/report`,
        {
          method: 'POST',
          body: JSON.stringify(reportForm),
        },
      );
      toast.success('已提交举报');
      setReportForm(prev => ({ ...prev, content: '' }));
      fetchInvite(invite.share_id);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  function nextPrompt(gameId: string) {
    setGameCursor(prev => ({
      ...prev,
      [gameId]:
        ((prev[gameId] || 0) + 1) %
        (builtInGames.find(item => item.id === gameId)?.prompts.length || 1),
    }));
  }

  function shareLink() {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('ui', mode);
    if (invite?.share_id) url.searchParams.set('invite', invite.share_id);
    return url.toString();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink());
      toast.success('分享链接已复制');
    } catch {
      window.prompt('长按复制这条邀请链接', shareLink());
    }
  }

  async function copyShareText() {
    if (!previewInvite) return;
    const text = `${previewInvite.title}｜${formatDate(previewInvite.event_date, previewInvite.event_time)}，${previewInvite.venue}。${previewInvite.aa_rule}。来不来都给个回应：${shareLink()}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('邀请文案已复制');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  }

  async function shareInvite() {
    if (!invite) return;
    if (isWechat) {
      setShowShareGuide(true);
      return;
    }
    if (!navigator.share) {
      await copyLink();
      toast.message('链接已准备好，可以粘贴到微信好友或群聊');
      return;
    }
    try {
      await navigator.share({
        title: invite.title,
        text: `${invite.aa_rule}｜${formatDate(invite.event_date, invite.event_time)}｜${invite.venue}`,
        url: shareLink(),
      });
    } catch {
      // 用户主动取消系统分享面板时不打扰。
    }
  }

  function startFresh() {
    setInvite(null);
    setInviteShareId('');
    setScreen('create');
  }

  function confirmJump() {
    if (!jumpTarget || typeof window === 'undefined') return;
    const target = jumpTarget.url.startsWith('http')
      ? jumpTarget.url
      : `${window.location.origin}${jumpTarget.url}${jumpTarget.url.includes('?') ? '&' : '?'}from=party`;
    window.open(target, '_blank', 'noopener,noreferrer');
    setJumpTarget(null);
  }

  return (
    <main className="party-root" data-theme={mode}>
      <title>
        {invite ? `${invite.title}｜喝一杯吗` : '喝一杯吗｜朋友间轻组局'}
      </title>
      <meta
        name="description"
        content="发起一场周末酒局，分享给微信好友并实时收集报名。"
      />
      <Toaster position="top-center" richColors />
      <div className="party-shell">
        <header className="party-topbar">
          <button type="button" className="brand-lockup" onClick={startFresh}>
            <span className="brand-mark">
              <Wine size={18} />
            </span>
            <span>
              <b>喝一杯吗</b>
              <small>朋友间轻组局工具</small>
            </span>
          </button>
          <div className="topbar-actions">
            <div className="theme-switcher">
              {(['amber', 'velvet'] as UiMode[]).map(item => (
                <button
                  key={item}
                  type="button"
                  className={`theme-chip ${mode === item ? 'active' : ''}`}
                  onClick={() => setMode(item)}
                >
                  <span>{themeCopy[item].name}</span>
                  <small>{themeCopy[item].label}</small>
                </button>
              ))}
            </div>
            {host ? (
              <div className="host-pill">
                <MiniAvatar text={host.nickname} />
                <span>{host.nickname}</span>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowLogin(true)}>
                确认主理人身份
              </Button>
            )}
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="eyebrow">微信可打开 · 报名实时同步</p>
            <h1>{themeCopy[mode].name}</h1>
            <p className="hero-copy">
              {themeCopy[mode].mood} {themeCopy[mode].accent}
            </p>
            <div className="hero-tags">
              <span>
                <Sparkles size={14} /> 朋友感
              </span>
              <span>
                <GlassWater size={14} /> 微醺氛围
              </span>
              <span>
                <TicketCheck size={14} /> 发局 / 报名 / 局中互动
              </span>
            </div>
          </div>
          <div className="hero-side">
            <div className="hero-side-label">当前能力覆盖</div>
            <div className="metric-grid">
              <div>
                <b>公开分享</b>
                <span>好友在微信中打开即可报名</span>
              </div>
              <div>
                <b>实时收集</b>
                <span>报名、候补与审核状态在线同步</span>
              </div>
            </div>
          </div>
        </section>

        <div className="page-grid">
          <section className="editor-panel section-card">
            <div className="section-head">
              <div>
                <p className="section-kicker">
                  {screen === 'create'
                    ? '创建与管理'
                    : invite?.viewer_is_host
                      ? '主理人管理'
                      : '报名与分享'}
                </p>
                <h2>
                  {screen === 'create'
                    ? '新开一局'
                    : invite?.viewer_is_host
                      ? '这场酒局的控制台'
                      : '回应这场邀请'}
                </h2>
              </div>
              {screen === 'detail' ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={startFresh}
                >
                  <ArrowLeft size={16} /> 再开新局
                </button>
              ) : null}
            </div>

            {screen === 'create' ? (
              <div className="form-stack">
                <div className="field-block">
                  <span>酒局标题</span>
                  <Input
                    value={form.title}
                    onChange={event =>
                      setForm({ ...form, title: event.target.value })
                    }
                  />
                </div>
                <div className="field-row two-col">
                  <div className="field-block">
                    <span>日期</span>
                    <Input
                      type="date"
                      value={form.event_date}
                      onChange={event =>
                        setForm({ ...form, event_date: event.target.value })
                      }
                    />
                  </div>
                  <div className="field-block">
                    <span>时间</span>
                    <Input
                      type="time"
                      value={form.event_time}
                      onChange={event =>
                        setForm({ ...form, event_time: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="field-block">
                  <span>地点</span>
                  <Input
                    value={form.venue}
                    onChange={event =>
                      setForm({ ...form, venue: event.target.value })
                    }
                  />
                </div>
                <div className="field-row two-col">
                  <div className="field-block">
                    <span>氛围</span>
                    <select
                      value={form.vibe}
                      onChange={event =>
                        setForm({ ...form, vibe: event.target.value })
                      }
                    >
                      {vibeOptions.map(item => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-block">
                    <span>人数上限</span>
                    <Input
                      type="number"
                      min={2}
                      max={50}
                      value={form.capacity}
                      onChange={event =>
                        setForm({
                          ...form,
                          capacity: Number(event.target.value) || 2,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="field-block">
                  <span>AA 规则（必填）</span>
                  <Input
                    value={form.aa_rule}
                    onChange={event =>
                      setForm({ ...form, aa_rule: event.target.value })
                    }
                  />
                </div>
                <div className="field-block">
                  <span>邀请说明</span>
                  <Textarea
                    rows={4}
                    value={form.message}
                    onChange={event =>
                      setForm({ ...form, message: event.target.value })
                    }
                  />
                </div>
                <div className="field-block">
                  <span>局前规则</span>
                  <Textarea
                    rows={3}
                    value={form.house_rules}
                    onChange={event =>
                      setForm({ ...form, house_rules: event.target.value })
                    }
                  />
                </div>
                <div className="toggle-grid">
                  <div className="toggle-card">
                    <div>
                      <b>主理人审核</b>
                      <small>开启后，Going / Maybe 先进入待确认</small>
                    </div>
                    <Switch
                      checked={form.review_required}
                      onCheckedChange={checked =>
                        setForm({ ...form, review_required: checked })
                      }
                    />
                  </div>
                  <div className="toggle-card">
                    <div>
                      <b>18+ 提示</b>
                      <small>酒局详情页常驻展示未成年人限制</small>
                    </div>
                    <Switch
                      checked={form.adults_only}
                      onCheckedChange={checked =>
                        setForm({ ...form, adults_only: checked })
                      }
                    />
                  </div>
                </div>
                <div className="toggle-grid">
                  <div className="toggle-card">
                    <div>
                      <b>允许公开分享</b>
                      <small>关闭后，只建议好友定向转发</small>
                    </div>
                    <Switch
                      checked={form.public_share}
                      onCheckedChange={checked =>
                        setForm({ ...form, public_share: checked })
                      }
                    />
                  </div>
                  <div className="toggle-card static-card">
                    <div>
                      <b>当前视觉方案</b>
                      <small>{themeCopy[mode].label}</small>
                    </div>
                    <span className="theme-badge">
                      {mode === 'amber' ? 'A' : 'B'}
                    </span>
                  </div>
                </div>
                <div className="cta-row">
                  <Button
                    onClick={createInvite}
                    disabled={busyKey === 'create'}
                  >
                    {busyKey === 'create' ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <Send size={16} />
                    )}
                    生成分享卡
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowLogin(true)}
                  >
                    确认主理人身份
                  </Button>
                </div>
              </div>
            ) : invite ? (
              <div className="control-stack">
                <div className="inline-actions">
                  <Button variant="secondary" onClick={copyLink}>
                    <Copy size={16} /> 复制链接
                  </Button>
                  <Button variant="secondary" onClick={copyShareText}>
                    <MessageCircleMore size={16} /> 复制邀请文案
                  </Button>
                  <Button variant="secondary" onClick={shareInvite}>
                    <Send size={16} /> {isWechat ? '分享到微信' : '分享邀请'}
                  </Button>
                </div>
                <div className="status-row">
                  <span className={`status-pill status-${invite.status}`}>
                    {statusCopy(invite.status)}
                  </span>
                  <span className="status-pill subtle">
                    {invite.review_required ? '需要审核' : '自动通过'}
                  </span>
                  <span className="status-pill subtle">
                    {invite.adults_only ? '18+' : '无年龄提示'}
                  </span>
                </div>
                {invite.viewer_is_host ? (
                  <div className="host-actions">
                    <Button
                      variant="secondary"
                      onClick={() => updateInviteStatus('ongoing')}
                      disabled={busyKey === 'status-ongoing'}
                    >
                      标记进行中
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => updateInviteStatus('ended')}
                      disabled={busyKey === 'status-ended'}
                    >
                      标记结束
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => updateInviteStatus('cancelled')}
                      disabled={busyKey === 'status-cancelled'}
                    >
                      取消酒局
                    </Button>
                  </div>
                ) : null}

                {invite.viewer_is_host ? (
                  <div className="review-board">
                    <div className="mini-section-head">
                      <h3>待处理名单</h3>
                      <span>
                        {groupedRsvps.pending.length +
                          groupedRsvps.waitlist.length}{' '}
                        人待处理
                      </span>
                    </div>
                    {[...groupedRsvps.pending, ...groupedRsvps.waitlist]
                      .length ? (
                      <div className="review-list">
                        {[
                          ...groupedRsvps.pending,
                          ...groupedRsvps.waitlist,
                        ].map(item => (
                          <div key={item.id} className="review-item">
                            <div>
                              <b>{item.nickname}</b>
                              <p>
                                {item.response === 'going' ? 'Going' : 'Maybe'}{' '}
                                · {item.note || '还没留言'}
                              </p>
                            </div>
                            <div className="review-actions">
                              <button
                                type="button"
                                onClick={() => reviewRsvp(item.id, 'approve')}
                              >
                                通过
                              </button>
                              <button
                                type="button"
                                onClick={() => reviewRsvp(item.id, 'waitlist')}
                              >
                                候补
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => reviewRsvp(item.id, 'reject')}
                              >
                                拒绝
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        当前没有待确认或候补用户。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="guest-rsvp-card">
                    <div className="mini-section-head">
                      <h3>给主理人一个回应</h3>
                      <span>
                        {currentRsvp
                          ? `当前状态：${currentRsvp.status}`
                          : 'Going / Maybe 二选一'}
                      </span>
                    </div>
                    <div className="field-block compact">
                      <span>昵称</span>
                      <Input
                        value={rsvpForm.nickname}
                        onChange={event =>
                          setRsvpForm({
                            ...rsvpForm,
                            nickname: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="choice-row">
                      {(['going', 'maybe'] as RSVPResponse[]).map(item => (
                        <button
                          key={item}
                          type="button"
                          className={`choice-pill ${rsvpForm.response === item ? 'active' : ''}`}
                          onClick={() =>
                            setRsvpForm({ ...rsvpForm, response: item })
                          }
                        >
                          {item === 'going' ? 'Going' : 'Maybe'}
                        </button>
                      ))}
                    </div>
                    <div className="field-block compact">
                      <span>留言</span>
                      <Textarea
                        rows={3}
                        value={rsvpForm.note}
                        onChange={event =>
                          setRsvpForm({ ...rsvpForm, note: event.target.value })
                        }
                      />
                    </div>
                    <div className="cta-row">
                      <Button
                        onClick={() => submitRsvp(rsvpForm.response)}
                        disabled={busyKey.startsWith('rsvp-')}
                      >
                        {busyKey.startsWith('rsvp-') ? (
                          <Loader2 className="spin" size={16} />
                        ) : (
                          <UserRoundCheck size={16} />
                        )}{' '}
                        提交回应
                      </Button>
                      {currentRsvp && currentRsvp.status !== 'cancelled' ? (
                        <Button
                          variant="secondary"
                          onClick={() => submitRsvp('cancelled')}
                        >
                          撤回报名
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <section className="preview-panel">
            <article className="section-card invite-stage">
              <div className="stage-top">
                <div>
                  <p className="section-kicker">分享邀请卡</p>
                  <h2>{previewInvite.title}</h2>
                </div>
                <span className={`stage-chip stage-${previewInvite.status}`}>
                  {statusCopy(previewInvite.status)}
                </span>
              </div>
              <p className="invite-message">{previewInvite.message}</p>
              <div className="fact-grid">
                <div>
                  <span>
                    <Clock3 size={14} /> 时间
                  </span>
                  <b>
                    {formatDate(
                      previewInvite.event_date,
                      previewInvite.event_time,
                    )}
                  </b>
                </div>
                <div>
                  <span>
                    <MapPin size={14} /> 地点
                  </span>
                  <b>{previewInvite.venue}</b>
                </div>
                <div>
                  <span>
                    <UsersRound size={14} /> 名额
                  </span>
                  <b>
                    {previewInvite.counts.approved_going} /{' '}
                    {previewInvite.capacity}
                  </b>
                </div>
                <div>
                  <span>
                    <TicketCheck size={14} /> 规则
                  </span>
                  <b>{previewInvite.aa_rule}</b>
                </div>
              </div>
              <div className="rule-strip">
                <span>
                  {previewInvite.review_required
                    ? '主理人审核后入场'
                    : '自动通过报名'}
                </span>
                <span>
                  {previewInvite.adults_only ? '仅限 18+' : '未设置年龄提示'}
                </span>
                <span>{previewInvite.vibe}</span>
              </div>
              <div className="host-summary">
                <div className="host-user">
                  <MiniAvatar text={previewInvite.host.nickname} />
                  <div>
                    <b>{previewInvite.host.nickname}</b>
                    <span>主理人</span>
                  </div>
                </div>
                <div className="guest-pack">
                  {groupedRsvps.approvedGoing.slice(0, 4).map(item => (
                    <MiniAvatar key={item.id} text={item.nickname} />
                  ))}
                  {!groupedRsvps.approvedGoing.length ? (
                    <span className="waiting-copy">适合先发出去收反馈</span>
                  ) : null}
                </div>
              </div>
            </article>

            {invite ? (
              <>
                <article className="section-card bento-grid">
                  <div className="metric-card accent">
                    <b>{invite.counts.approved_going}</b>
                    <span>已确认 Going</span>
                  </div>
                  <div className="metric-card">
                    <b>{invite.counts.approved_maybe}</b>
                    <span>Maybe</span>
                  </div>
                  <div className="metric-card">
                    <b>{invite.counts.pending}</b>
                    <span>待审核</span>
                  </div>
                  <div className="metric-card">
                    <b>{invite.counts.waitlist}</b>
                    <span>候补</span>
                  </div>
                </article>

                <article className="section-card roster-card">
                  <div className="section-head compact-head">
                    <div>
                      <p className="section-kicker">名单与规则</p>
                      <h2>到场前信息都在这</h2>
                    </div>
                  </div>
                  <div className="roster-columns">
                    <div>
                      <h3>已通过名单</h3>
                      {[
                        ...groupedRsvps.approvedGoing,
                        ...groupedRsvps.approvedMaybe,
                      ].length ? (
                        <ul className="plain-list">
                          {[
                            ...groupedRsvps.approvedGoing,
                            ...groupedRsvps.approvedMaybe,
                          ].map(item => (
                            <li key={item.id}>
                              <b>{item.nickname}</b>
                              <span>
                                {item.response === 'going' ? 'Going' : 'Maybe'}{' '}
                                · {item.note || '无备注'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="empty-state">还没有通过名单。</div>
                      )}
                    </div>
                    <div>
                      <h3>局前规则</h3>
                      <ul className="rule-list">
                        <li>{invite.house_rules}</li>
                        <li>
                          {invite.adults_only
                            ? '未成年人不可参加，详情页常驻 18+ 提示。'
                            : '未设置年龄限制。'}
                        </li>
                        <li>
                          {invite.review_required
                            ? '报名需主理人确认，满员后自动进入候补。'
                            : '报名自动通过，满员后自动进入候补。'}
                        </li>
                      </ul>
                    </div>
                  </div>
                </article>

                <div className="double-grid">
                  <article className="section-card">
                    <div className="section-head compact-head">
                      <div>
                        <p className="section-kicker">提醒计划</p>
                        <h2>活动前自动提醒</h2>
                      </div>
                    </div>
                    <ul className="timeline-list">
                      {invite.reminders.length ? (
                        invite.reminders.map(item => (
                          <li key={item.id}>
                            <AlarmClock size={16} />
                            <div>
                              <b>{item.label}</b>
                              <span>{formatTime(item.scheduled_at)}</span>
                            </div>
                          </li>
                        ))
                      ) : (
                        <li>当前没有可用提醒计划。</li>
                      )}
                    </ul>
                  </article>
                  <article className="section-card">
                    <div className="section-head compact-head">
                      <div>
                        <p className="section-kicker">通知流</p>
                        <h2>关键动作留痕</h2>
                      </div>
                    </div>
                    <ul className="timeline-list">
                      {invite.notifications.length ? (
                        invite.notifications.map(item => (
                          <li key={item.id}>
                            <ChevronRight size={16} />
                            <div>
                              <b>{item.title}</b>
                              <span>
                                {item.body} · {formatTime(item.created_at)}
                              </span>
                            </div>
                          </li>
                        ))
                      ) : (
                        <li>当前还没有通知记录。</li>
                      )}
                    </ul>
                  </article>
                </div>

                <article className="section-card games-card">
                  <div className="section-head compact-head">
                    <div>
                      <p className="section-kicker">局内小游戏</p>
                      <h2>即开即玩，不把气氛做成压力</h2>
                    </div>
                  </div>
                  <div className="games-grid">
                    {builtInGames.map(game => {
                      const cursor = gameCursor[game.id] || 0;
                      return (
                        <div key={game.id} className="game-item">
                          <span className="game-badge">{game.badge}</span>
                          <h3>{game.title}</h3>
                          <p>{game.summary}</p>
                          <div className="prompt-box">
                            {game.prompts[cursor]}
                          </div>
                          <div className="inline-actions compact">
                            <Button
                              variant="secondary"
                              onClick={() => nextPrompt(game.id)}
                            >
                              <Sparkles size={14} /> 换一道
                            </Button>
                            <span className="hint-copy">
                              支持跳过，不强制喝酒
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>

                <article className="section-card games-card">
                  <div className="section-head compact-head">
                    <div>
                      <p className="section-kicker">每日推荐</p>
                      <h2>白名单扩展玩法 · 今天适合这桌</h2>
                    </div>
                  </div>
                  <div className="recommend-grid">
                    {dailyGames.map(item => (
                      <div key={item.id} className="recommend-card">
                        <div className="recommend-rank">0{item.rank}</div>
                        <div>
                          <div className="recommend-meta">
                            <span>{item.tag}</span>
                            <span>{item.fit}</span>
                          </div>
                          <h3>{item.title}</h3>
                          <p>{item.description}</p>
                          <small>
                            {item.source} ·{' '}
                            {item.jump_type === 'h5' ? 'H5 跳转' : '内置扩展'}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="jump-button"
                          onClick={() => setJumpTarget(item)}
                        >
                          前往玩法 <ExternalLink size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="section-card report-card">
                  <div className="section-head compact-head">
                    <div>
                      <p className="section-kicker">安全治理</p>
                      <h2>举报入口</h2>
                    </div>
                  </div>
                  <div className="field-row two-col">
                    <div className="field-block compact">
                      <span>你的名字</span>
                      <Input
                        value={reportForm.reporter_name}
                        onChange={event =>
                          setReportForm({
                            ...reportForm,
                            reporter_name: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="field-block compact">
                      <span>举报类型</span>
                      <select
                        value={reportForm.target_type}
                        onChange={event =>
                          setReportForm({
                            ...reportForm,
                            target_type: event.target.value as
                              | 'invite'
                              | 'game'
                              | 'external_game',
                          })
                        }
                      >
                        {reportTypes.map(item => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="field-block compact">
                    <span>问题描述</span>
                    <Textarea
                      rows={3}
                      value={reportForm.content}
                      onChange={event =>
                        setReportForm({
                          ...reportForm,
                          content: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="cta-row">
                    <Button
                      variant="secondary"
                      onClick={reportIssue}
                      disabled={busyKey === 'report'}
                    >
                      {busyKey === 'report' ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <ShieldAlert size={16} />
                      )}{' '}
                      提交举报
                    </Button>
                  </div>
                </article>
              </>
            ) : null}
          </section>
        </div>
      </div>

      {showLogin ? (
        <dialog className="modal-mask" open>
          <div className="modal-card">
            <div className="section-head compact-head">
              <div>
                <p className="section-kicker">主理人身份</p>
                <h2>先确认一个昵称</h2>
              </div>
            </div>
            <p className="modal-copy">
              设置一个主理人昵称后即可发局。创建成功后会生成公开链接，好友可直接在微信里打开并报名。
            </p>
            <div className="field-block compact">
              <span>昵称</span>
              <Input
                value={authName}
                onChange={event => setAuthName(event.target.value)}
              />
            </div>
            <div className="cta-row">
              <Button onClick={login} disabled={busyKey === 'login'}>
                {busyKey === 'login' ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}{' '}
                确认并登录
              </Button>
              <Button variant="secondary" onClick={() => setShowLogin(false)}>
                稍后再说
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}

      {showShareGuide ? (
        <dialog className="modal-mask" open>
          <div className="modal-card">
            <div className="section-head compact-head">
              <div>
                <p className="section-kicker">微信分享</p>
                <h2>从右上角发送给朋友</h2>
              </div>
            </div>
            <p className="modal-copy">
              点击微信右上角“···”，选择“发送给朋友”或“分享到朋友圈”。好友打开后即可直接填写昵称并报名，结果会实时汇总到主理人页面。
            </p>
            <div className="field-block compact">
              <span>公开邀请链接</span>
              <Input value={shareLink()} readOnly />
            </div>
            <div className="cta-row">
              <Button onClick={copyLink}>
                <Copy size={16} /> 复制备用链接
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowShareGuide(false)}
              >
                我知道了
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}

      {jumpTarget ? (
        <dialog className="modal-mask" open>
          <div className="modal-card">
            <div className="section-head compact-head">
              <div>
                <p className="section-kicker">即将离开当前酒局页</p>
                <h2>{jumpTarget.title}</h2>
              </div>
            </div>
            <p className="modal-copy">
              你将在新标签页打开推荐玩法，当前酒局页面会继续保留。
            </p>
            <div className="cta-row">
              <Button onClick={confirmJump}>
                <ExternalLink size={16} /> 前往玩法
              </Button>
              <Button variant="secondary" onClick={() => setJumpTarget(null)}>
                <XCircle size={16} /> 留在当前页
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}
    </main>
  );
}
