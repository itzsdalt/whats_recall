process.env.NODE_ENV = "test";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "whatsapp-connection-test-"));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = join(tempDir, "messages.db");

const mocks = vi.hoisted(() => {
  const socket = {
    ev: {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    end: vi.fn(),
    user: { id: "me@s.whatsapp.net" },
  };
  return {
    socket,
    makeWASocket: vi.fn(() => socket),
    useMultiFileAuthState: vi.fn(async () => ({
      state: { creds: { registered: true } },
      saveCreds: vi.fn(),
    })),
    fetchLatestBaileysVersion: vi.fn(async () => ({
      version: [2, 3000, 1015901307] as [number, number, number],
    })),
  };
});

vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whiskeysockets/baileys")>();
  return {
    ...actual,
    default: mocks.makeWASocket,
    useMultiFileAuthState: mocks.useMultiFileAuthState,
    fetchLatestBaileysVersion: mocks.fetchLatestBaileysVersion,
  };
});

const { WhatsAppConnection } = await import("../src/whatsapp/connection.ts");
const { getDb } = await import("../src/db/database.ts");

describe("WhatsApp connection identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.makeWASocket.mockClear();
  });

  afterAll(() => {
    vi.useRealTimers();
    getDb().close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("passes the Android Chrome identity to makeWASocket", async () => {
    const connection = new WhatsAppConnection(vi.fn());
    await connection.start();

    expect(mocks.makeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: ["Android", "Chrome", "14.0.0"],
      }),
    );
  });
});
