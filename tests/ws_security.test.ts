process.env.NODE_ENV = "test";
import { expect, test } from "vitest";
import { getDb } from "../src/db/database";
import { createHonoServer } from "../src/api/server";
import { WebSocket } from "ws";

test("WebSocket session invalidation", async () => {
    // Setup server
    const mockClient: any = { isReady: true, isAuthenticated: true };
    process.env.AUTH_PASSWORD = "secure_password_123";
    process.env.WEB_PORT = "0";
    const { start, broadcast } = createHonoServer(mockClient);

    const { nodeServer } = start();

    const db = getDb();
    db.createSession("test_token", "fp1", new Date(Date.now() + 100000).toISOString());

    // Connect WS
    const address = nodeServer.address();
    if (!address || typeof address === 'string') throw new Error('HTTP server did not bind to a TCP port');
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
        headers: { "X-Auth-Token": "test_token", "X-Fingerprint": "fp1" }
    });

    await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    let receivedData: any = null;
    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.event === "new_message") receivedData = msg.data;
    });

    broadcast("new_message", "hello");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(receivedData).toBe("hello"); // Should receive data

    // Logout (delete session)
    db.deleteSession("test_token");

    // Broadcast again
    receivedData = null;
    broadcast("new_message", "hello_again");
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(receivedData).toBeNull(); // Should not receive data, should be disconnected

    ws.close();
    await new Promise<void>((resolve, reject) => {
        nodeServer.close((error) => error ? reject(error) : resolve());
    });
});
