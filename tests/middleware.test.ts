process.env.NODE_ENV = "test"; // Must be FIRST
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Setup temporary directory for test database/media
const tempDir = mkdtempSync(join(tmpdir(), "whatsapp-middleware-test-"));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = join(tempDir, "messages.db");

import { expect, test, describe, beforeEach, beforeAll, afterAll, vi } from "vitest";

const { getDb, dbInstances } = await import("../src/db/database.ts");

// No global mocking of hono/cookie as it interferes with other tests.
// Use standard mocks for headers instead.

describe("authMiddleware", () => {
  let mockContext: any;
  let mockNext: any;
  let db: any;
  let authMiddleware: any;

  beforeAll(async () => {
    
    db = getDb();
    const mod = await import("../src/api/middleware.ts");
    authMiddleware = mod.authMiddleware;
  });

  beforeEach(async () => {
    await db.clearAllData();
    mockNext = vi.fn(() => Promise.resolve());
    
    // Create a mock headers object that getCookie can use
    const headersMap = new Map<string, string>();
    
    mockContext = {
      req: {
        path: "/api/chats",
        header: vi.fn((name: string) => headersMap.get(name.toLowerCase())),
        raw: {
          headers: {
            get: vi.fn((name: string) => headersMap.get(name.toLowerCase()))
          }
        }
      },
      json: vi.fn((data: any, status: number) => ({ data, status })),
      get: vi.fn(() => undefined),
      set: vi.fn(() => undefined),
      _headersMap: headersMap // helper for tests
    };
  });

  afterAll(() => {
    if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("should allow login and verify paths without token", async () => {
    mockContext.req.path = "/api/auth/login";
    await authMiddleware(mockContext, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test("should return 401 if no token is found in cookies or headers", async () => {
    await expect(authMiddleware(mockContext, mockNext)).rejects.toThrow();
  });

  test("should return 401 if session is not found in database", async () => {
    mockContext._headersMap.set('x-auth-token', 'non-existent-token');
    await expect(authMiddleware(mockContext, mockNext)).rejects.toThrow();
  });

  test("should return 401 if fingerprint mismatch", async () => {
    const token = "valid-token";
    // Use datetime('now', '+1 hour') to ensure it's not expired in SQLite's view
    db.raw.query("INSERT INTO sessions (token, fingerprint, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").run(token, "correct-fingerprint");
    
    mockContext._headersMap.set('x-auth-token', token);
    mockContext._headersMap.set('x-fingerprint', 'wrong-fingerprint');
    
    await expect(authMiddleware(mockContext, mockNext)).rejects.toThrow();
  });

  test("should call next() if session is valid and fingerprint matches", async () => {
    const token = "valid-token";
    db.raw.query("INSERT INTO sessions (token, fingerprint, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").run(token, "correct-fingerprint");

    mockContext._headersMap.set('x-auth-token', token);
    mockContext._headersMap.set('x-fingerprint', 'correct-fingerprint');

    await authMiddleware(mockContext, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
