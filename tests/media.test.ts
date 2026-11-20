process.env.NODE_ENV = "test";
import { expect, test, describe, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = mkdtempSync(join(tmpdir(), "whatsapp-media-test-"));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = join(tempDir, "messages.db");
process.env.MEDIA_DIR = join(tempDir, "media");

const { downloadMediaMock } = vi.hoisted(() => ({
    downloadMediaMock: vi.fn(async () => Buffer.from("fake media content")),
}));
vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@whiskeysockets/baileys")>();
    return { ...actual, downloadMediaMessage: downloadMediaMock };
});

// Mocking fetch for profile pic
// Use any to avoid missing fetch properties like 'preconnect' in Bun types
(global as any).fetch = async (_url: string) => {
    const image = Buffer.from("fake profile pic");
    const exactBuffer = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
    return {
        ok: true,
        arrayBuffer: async () => exactBuffer
    };
};

import { getDb } from "../src/db/database.ts";
import { downloadMedia, downloadProfilePic, downloadViewOnceMedia } from "../src/whatsapp/media.ts";

describe("Media Utils", () => {
    let db: any;

    beforeAll(async () => {
        db = getDb(process.env.DB_PATH, process.env.MEDIA_DIR);
        if (!existsSync(process.env.MEDIA_DIR!)) {
            mkdirSync(process.env.MEDIA_DIR!, { recursive: true });
        }
    });

    beforeEach(async () => {
        await db.clearAllData();
        downloadMediaMock.mockClear();
        // Ensure media dir exists after clearAllData
        if (!existsSync(process.env.MEDIA_DIR!)) {
            mkdirSync(process.env.MEDIA_DIR!, { recursive: true });
        }
    });

    afterAll(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("downloadProfilePic should download and save profile picture in profile/", async () => {
        const sock = {
            profilePictureUrl: async () => "https://example.com/pic.jpg"
        };
        
        db.upsertChat("user1@s.whatsapp.net", "User 1", false);
        const result = await downloadProfilePic("user1@s.whatsapp.net", sock);
        expect(result).not.toBeNull();
        expect(result?.isNew).toBe(true);
        expect(result?.filename).toMatch(/^profile\/dp_[a-f0-9]{16}\.jpg$/);
        expect(existsSync(join(process.env.MEDIA_DIR!, result?.filename!))).toBe(true);
        
        const dbPic = db.getChatProfilePic("user1@s.whatsapp.net");
        expect(dbPic).toBe(result?.filename);
    });

    test("downloadProfilePic should reuse existing profile picture from disk", async () => {
        const sock = {
            profilePictureUrl: async () => "https://example.com/pic.jpg"
        };
        
        const result1 = await downloadProfilePic("user2@s.whatsapp.net", sock);
        const result2 = await downloadProfilePic("user3@s.whatsapp.net", sock);

        expect(result1?.filename).toBe(result2?.filename);
        expect(result2?.isNew).toBe(false);
    });

    test("downloadMedia should download and save media in images/", async () => {
        const message = {
            message: {
                imageMessage: {
                    directPath: "/media/image",
                    mediaKey: Buffer.alloc(32, 1),
                    fileLength: 10,
                    fileSha256: Buffer.from("fake-sha256")
                }
            }
        };
        
        const result = await downloadMedia(message as any, "image");
        expect(result).not.toBeNull();
        expect(result?.sha256hex).toBe(Buffer.from("fake-sha256").toString('hex'));
        expect(result?.path).toMatch(/^images\//);
        expect(existsSync(join(process.env.MEDIA_DIR!, result?.path!))).toBe(true);
    });

    test("downloadMedia must not persist View Once media", async () => {
        const message = {
            message: {
                viewOnceMessage: {
                    message: {
                        videoMessage: {
                            directPath: "/media/video",
                            mediaKey: Buffer.alloc(32, 2),
                            fileLength: 10,
                            fileSha256: Buffer.from("video-sha256")
                        }
                    }
                }
            }
        };

        const filesBefore = readdirSync(process.env.MEDIA_DIR!);
        const result = await downloadMedia(message as any, "video");
        expect(result).toBeNull();
        expect(downloadMediaMock).not.toHaveBeenCalled();
        expect(readdirSync(process.env.MEDIA_DIR!)).toEqual(filesBefore);
    });

    test("downloadViewOnceMedia keeps delivered bytes in memory and unwraps associated children", async () => {
        const filesBefore = readdirSync(process.env.MEDIA_DIR!);
        const result = await downloadViewOnceMedia({
            message: {
                associatedChildMessage: {
                    message: {
                        imageMessage: {
                            directPath: "/media/once",
                            mediaKey: Buffer.alloc(32, 3),
                            fileLength: 10,
                            mimetype: "image/jpeg",
                        },
                    },
                },
            },
        } as any, "image");

        expect(result?.buffer).toEqual(Buffer.from("fake media content"));
        expect(result?.mimeType).toBe("image/jpeg");
        expect(downloadMediaMock).toHaveBeenCalledOnce();
        expect(readdirSync(process.env.MEDIA_DIR!)).toEqual(filesBefore);
    });

    test("downloadMedia should return null if no media found", async () => {
        const message = { message: { conversation: "hello" } };
        const result = await downloadMedia(message as any, "image");
        expect(result).toBeNull();
        expect(downloadMediaMock).not.toHaveBeenCalled();
    });
});
