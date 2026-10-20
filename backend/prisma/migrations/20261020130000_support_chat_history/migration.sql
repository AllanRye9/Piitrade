-- Saved support-chat conversation per logged-in user (GET/PUT/DELETE /support/chat/history).
CREATE TABLE "SupportChatHistory" (
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "handoffDone" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportChatHistory_pkey" PRIMARY KEY ("userId")
);
