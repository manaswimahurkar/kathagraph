/**
 * A plain-words box at the top of a page: what the page shows, and what the visitor can do with it.
 * Same look as the "What this is / What you can do" boxes on a monument's record.
 */
export default function Explainer({ what, how }: { what: React.ReactNode; how: React.ReactNode }) {
  return (
    <div className="mt-4 max-w-3xl space-y-1.5 rounded-md border border-line bg-sand/50 px-3.5 py-2.5 text-[15px] leading-relaxed">
      <div>
        <span className="mr-1.5 font-medium text-ochre">What this is:</span>
        {what}
      </div>
      <div>
        <span className="mr-1.5 font-medium text-water">What you can do:</span>
        {how}
      </div>
    </div>
  );
}
