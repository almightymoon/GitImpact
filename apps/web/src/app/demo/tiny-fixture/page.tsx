import { RepositoryWorkbench } from "@/components/RepositoryWorkbench";

export default function DemoPage() {
  return (
    <RepositoryWorkbench
      analysisId="demo/tiny-fixture"
      title="demo/tiny-fixture"
      githubUrl="local://demo/tiny-fixture"
    />
  );
}
