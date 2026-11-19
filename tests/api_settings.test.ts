process.env.NODE_ENV = "test";
import { expect, test, describe, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = mkdtempSync(join(tmpdir(), "whatsapp-api-settings-test-"));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = join(tempDir, "messages.db");

import { getDb } from "../src/db/database.ts";
import { createSettingsRouter } from "../src/api/settings.ts";
import settingsApi from "../src/api/settings.ts";

describe("API /settings", () => {
    let db: any;

    beforeAll(async () => {
        db = getDb();
    });

    beforeEach(async () => {
        await db.clearAllData();
    });

    afterAll(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("GET / should return settings", async () => {
        db.updateSetting("test_key", "test_value");
        
        const res = await settingsApi.request("/");
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.test_key).toBe("test_value");
    });

    test("POST /update should update a setting", async () => {
        const res = await settingsApi.request("/update", {
            method: "POST",
            body: JSON.stringify({ key: "new_key", value: "new_value" }),
            headers: { "Content-Type": "application/json" }
        });
        
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        
        const settings = db.getSettings();
        expect(settings.new_key).toBe("new_value");
    });

    test("POST /update should apply online privacy and save it", async () => {
        const updates: Array<[string, string]> = [];
        const router = createSettingsRouter({
            updatePrivacySetting: async (key, value) => {
                updates.push([key, value]);
            }
        });
        const res = await router.request("/update", {
            method: "POST",
            body: JSON.stringify({ key: "whatsapp_hide_online", value: "true" }),
            headers: { "Content-Type": "application/json" }
        });

        expect(res.status).toBe(200);
        expect(updates).toEqual([["whatsapp_hide_online", "true"]]);
        expect(db.getSettings().whatsapp_hide_online).toBe("true");
    });

    test("POST /update should apply read receipt privacy and save it", async () => {
        const updates: Array<[string, string]> = [];
        const router = createSettingsRouter({
            updatePrivacySetting: async (key, value) => {
                updates.push([key, value]);
            }
        });
        const res = await router.request("/update", {
            method: "POST",
            body: JSON.stringify({ key: "whatsapp_hide_read_receipts", value: "true" }),
            headers: { "Content-Type": "application/json" }
        });

        expect(res.status).toBe(200);
        expect(updates).toEqual([["whatsapp_hide_read_receipts", "true"]]);
        expect(db.getSettings().whatsapp_hide_read_receipts).toBe("true");
    });
});
