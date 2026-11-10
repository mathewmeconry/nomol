import Tablet from '~/components/Tablet';
import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Nomol' }, { name: 'description', content: 'Aufnehmen, anschauen, nomol.' }];
}

export default function Home() {
  return <Tablet />;
}
