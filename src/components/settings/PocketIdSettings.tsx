"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  connectPocketId,
  disconnectPocketId,
  getPocketIdStatus,
} from "@/actions/pocketId.actions";

type Status = Awaited<ReturnType<typeof getPocketIdStatus>>;

const ERRORS: Record<string, string> = {
  PocketIdAlreadyLinked:
    "That Pocket ID account is already connected to another JobSync user.",
  PocketIdUserAlreadyLinked:
    "Your account already has a Pocket ID connected. Disconnect it first.",
  PocketIdNotLinked: "Pocket ID did not return an account id. Try again.",
};

export default function PocketIdSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("pocketIdError");
  const justLinked = searchParams.get("pocketId") === "linked";

  useEffect(() => {
    getPocketIdStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const disconnect = () =>
    startTransition(async () => {
      try {
        await disconnectPocketId();
        setStatus((s) => (s ? { ...s, linked: false, linkedAt: null } : s));
        toastSuccess("Pocket ID disconnected.");
      } catch {
        toastError("Could not disconnect Pocket ID.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in</CardTitle>
        <CardDescription>
          Connect Pocket ID to sign in with a passkey. Your password login
          keeps working.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!status ? null : !status.enabled ? (
          <p className="text-sm text-muted-foreground">
            Pocket ID login is not configured on this instance.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Pocket ID</span>
            {status.linked ? (
              <>
                <Badge variant="secondary">Connected</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={disconnect}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => startTransition(() => connectPocketId())}
              >
                Connect Pocket ID
              </Button>
            )}
          </div>
        )}
        {status?.enabled && justLinked && status.linked && !errorCode && (
          <p className="text-sm text-green-600">Pocket ID connected.</p>
        )}
        {errorCode && (
          <p className="text-sm text-red-500" role="alert">
            {ERRORS[errorCode] ?? "Connecting Pocket ID failed."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
