import { RepositoryWorkbench } from "@/components/RepositoryWorkbench";

export default function DemoPullRequestPage() {
  return (
    <RepositoryWorkbench
      analysisId="demo/tiny-fixture/pull/1"
      title="demo/tiny-fixture · PR #1"
      githubUrl="local://demo/tiny-fixture/pull/1"
      isPullRequest
    />
  );
}
