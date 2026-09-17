import { RepositoryWorkbench } from "@/components/RepositoryWorkbench";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepositoryPage({ params }: PageProps) {
  const { owner, repo } = await params;
  const id = `${owner}/${repo}`;

  return (
    <RepositoryWorkbench
      analysisId={id}
      title={`${owner}/${repo}`}
      githubUrl={`https://github.com/${owner}/${repo}`}
    />
  );
}
