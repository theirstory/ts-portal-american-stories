import { redirect } from 'next/navigation';

// Route hidden for now — supporting client/component files stay in place so
// it can be re-enabled later by restoring the original page implementation.
export default function ThroughlinesPage() {
  redirect('/');
}
