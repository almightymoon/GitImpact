import { RepositoryWorkbench } from "@/components/RepositoryWorkbench";

type PageProps = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

export default async function PullRequestPage({ params }: PageProps) {
  const { owner, repo, number } = await params;
  const id = `${owner}/${repo}/pull/${number}`;

  return (
    <RepositoryWorkbench
      analysisId={id}
      title={`${owner}/${repo} · PR #${number}`}
      githubUrl={`https://github.com/${owner}/${repo}/pull/${number}`}
      isPullRequest
    />
  );
}
