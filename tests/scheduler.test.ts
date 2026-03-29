/**
 * Tests for scheduler tick logic (tick locking, year advancement).
 *
 * The Discord client and channel fetching are mocked so these tests run without
 * any network access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock functions so they are available inside vi.mock factories ───────
const { mockApplyTick, mockAdvanceYear, mockGetCurrentYear, mockIsTickFrozen } = vi.hoisted(() => ({
  mockApplyTick: vi.fn(),
  mockAdvanceYear: vi.fn().mockReturnValue(2325),
  mockGetCurrentYear: vi.fn().mockReturnValue(2325),
  mockIsTickFrozen: vi.fn().mockReturnValue(false),
}));

// ── Mock the DB layer so we don't need a real database ───────────────────────
vi.mock('../src/db/schema', () => ({
  applyTick: mockApplyTick,
  advanceYear: mockAdvanceYear,
  getCurrentYear: mockGetCurrentYear,
  isTickFrozen: mockIsTickFrozen,
}));

// ── Mock discord.js ───────────────────────────────────────────────────────────
vi.mock('discord.js', async () => {
  const actual = await vi.importActual<typeof import('discord.js')>('discord.js');

  function MockEmbedBuilder(this: any) {
    this.setTitle = vi.fn().mockReturnThis();
    this.setDescription = vi.fn().mockReturnThis();
    this.setColor = vi.fn().mockReturnThis();
    this.setFooter = vi.fn().mockReturnThis();
    this.setTimestamp = vi.fn().mockReturnThis();
  }

  return {
    ...actual,
    EmbedBuilder: MockEmbedBuilder,
    TextChannel: class TextChannel {},
  };
});

// Import after mocks are set up
import { runTick } from '../src/utils/scheduler';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockClient(channelType: 'text' | 'missing' | 'wrong-type' = 'text') {
  const { TextChannel } = require('discord.js');

  const mockChannel =
    channelType === 'text'
      ? Object.assign(Object.create(TextChannel.prototype), {
          send: vi.fn().mockResolvedValue(undefined),
        })
      : channelType === 'missing'
        ? null
        : {}; // not a TextChannel instance

  return {
    channels: {
      fetch: vi.fn().mockResolvedValue(mockChannel),
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Scheduler — runTick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TIMELINE_CHANNEL_ID = 'mock-channel-id';
  });

  it('calls applyTick and advanceYear', async () => {
    const client = makeMockClient();
    await runTick(client);
    expect(mockApplyTick).toHaveBeenCalledOnce();
    expect(mockAdvanceYear).toHaveBeenCalledWith(25);
  });

  it('returns true on a successful tick', async () => {
    const client = makeMockClient();
    const result = await runTick(client);
    expect(result).toBe(true);
  });

  it('posts an announcement to the timeline channel', async () => {
    const client = makeMockClient();
    await runTick(client);
    expect(client.channels.fetch).toHaveBeenCalledWith('mock-channel-id');
    // The channel mock's send should have been called by the scheduler
    const channel = await client.channels.fetch.mock.results[0].value;
    expect(channel.send).toHaveBeenCalledOnce();
  });
});

describe('Scheduler — tick locking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTickFrozen.mockReturnValue(false);
    process.env.TIMELINE_CHANNEL_ID = 'mock-channel-id';
  });

  it('returns false and skips DB work when a tick is already running', async () => {
    // Simulate a slow tick by making the channel fetch never resolve during the test
    let resolveFetch!: (value: any) => void;
    const hangingClient = {
      channels: {
        fetch: vi.fn().mockReturnValue(new Promise((res) => { resolveFetch = res; })),
      },
    } as any;

    // Start first tick but don't await it — it will hang on channels.fetch
    const first = runTick(hangingClient);

    // Second tick should be rejected immediately
    const second = await runTick(hangingClient);
    expect(second).toBe(false);
    expect(mockApplyTick).toHaveBeenCalledOnce(); // only the first tick called it

    // Clean up: resolve the hanging fetch so the first tick can finish
    resolveFetch(null);
    await first;
  });

  it('allows a new tick after the previous one completes', async () => {
    const client = makeMockClient('missing'); // channel not found → resolves quickly
    await runTick(client);
    const result = await runTick(client);
    expect(result).toBe(true);
    expect(mockApplyTick).toHaveBeenCalledTimes(2);
  });
});

describe('Scheduler — tick freezing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TIMELINE_CHANNEL_ID = 'mock-channel-id';
  });

  it('returns false and skips DB work when tick is frozen', async () => {
    mockIsTickFrozen.mockReturnValue(true);
    const client = makeMockClient();
    const result = await runTick(client);
    expect(result).toBe(false);
    expect(mockApplyTick).not.toHaveBeenCalled();
  });

  it('allows tick to run when not frozen', async () => {
    mockIsTickFrozen.mockReturnValue(false);
    const client = makeMockClient();
    const result = await runTick(client);
    expect(result).toBe(true);
    expect(mockApplyTick).toHaveBeenCalledOnce();
  });
});

describe('Scheduler — missing TIMELINE_CHANNEL_ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TIMELINE_CHANNEL_ID;
  });

  it('still applies the tick and returns true even without a channel ID', async () => {
    const client = makeMockClient();
    const result = await runTick(client);
    expect(result).toBe(true);
    expect(mockApplyTick).toHaveBeenCalledOnce();
    // Should not attempt to fetch the channel
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});
