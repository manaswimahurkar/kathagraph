import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-16 text-center">
      <h1 className="font-display text-4xl">This page isn&apos;t in the archive</h1>
      <p className="mt-2 text-dust">The link may be old, or the address mistyped.</p>
      <Link href="/" className="mt-6 inline-block rounded-md bg-water px-5 py-2.5 font-medium text-paper">
        Go to the map
      </Link>
    </main>
  );
}
