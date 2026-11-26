import { redirect } from 'next/navigation';

// The prototype starts at the lab search (I1-CUS-10). The approved home page replaces this later.
export default function HomePage(): never {
  redirect('/search');
}
