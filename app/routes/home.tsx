import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Nomol' }, { name: 'description', content: 'Aufnehmen, anschauen, nomol.' }];
}

export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <h1 className="text-4xl font-bold">Nomol</h1>
    </main>
  );
}
