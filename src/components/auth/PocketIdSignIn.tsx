"use client";

import { useTransition } from "react";
import { signInWithPocketId } from "@/actions/auth.actions";
import { Button } from "../ui/button";
import Loading from "../Loading";

interface PocketIdSignInProps {
  error?: string | null;
}

// Rendered only when the server has Pocket ID configured.
export default function PocketIdSignIn({ error }: PocketIdSignInProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-2 grid gap-3">
      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={isPending}
        onClick={() => startTransition(() => signInWithPocketId())}
      >
        {isPending ? <Loading /> : "Sign in with Pocket ID"}
      </Button>
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
