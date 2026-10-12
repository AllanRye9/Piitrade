import { redirect } from 'next/navigation';

// Candidate profiles / public CV pages no longer exist: a CV is shared only
// through a job application. Old links land on the job board.
export default function RemovedCandidateProfilePage() {
  redirect('/jobs');
}
