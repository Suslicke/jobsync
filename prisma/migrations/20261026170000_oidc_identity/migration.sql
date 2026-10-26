-- CreateTable
CREATE TABLE "OidcIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OidcIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OidcIdentity_provider_subject_key" ON "OidcIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "OidcIdentity_userId_provider_key" ON "OidcIdentity"("userId", "provider");

