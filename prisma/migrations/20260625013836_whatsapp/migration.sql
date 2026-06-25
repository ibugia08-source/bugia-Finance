-- CreateTable
CREATE TABLE "WhatsAppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'zapi',
    "baseUrl" TEXT,
    "instanceId" TEXT,
    "token" TEXT,
    "clientToken" TEXT,
    "myNumber" TEXT,
    "remindersSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "direction" TEXT NOT NULL,
    "waType" TEXT NOT NULL DEFAULT 'text',
    "fromNumber" TEXT,
    "body" TEXT,
    "mediaUrl" TEXT,
    "intent" TEXT,
    "actionTaken" TEXT,
    "status" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt");
