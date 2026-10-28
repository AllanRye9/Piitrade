import { redirect } from 'next/navigation';

// Saved searches became "Alerts" (instant e-mail, profile and sound notifications): same data, one page.
export default function SavedSearchesRedirect() {
  redirect('/profile/alerts');
}
