interface CauseStepsProps {
  cause: string | null;
  steps: string | null;
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-3">
      <p className="text-foreground text-xs font-semibold">{title}</p>
      <p className="text-foreground/80 mt-1 text-sm whitespace-pre-line">{text}</p>
    </div>
  );
}

/** "Przyczyna" / "Kroki" blocks, shared by knowledge-base matches and resolved tickets. Empty parts are skipped. */
export function CauseSteps({ cause, steps }: CauseStepsProps) {
  return (
    <>
      {cause && <Block title="Przyczyna" text={cause} />}
      {steps && <Block title="Kroki" text={steps} />}
    </>
  );
}
