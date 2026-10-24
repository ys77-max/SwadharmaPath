import { Hammer } from 'lucide-react'
import { Empty, PageHeader } from '@/components/states'

/** Routes outside the "Start Here" scope render this until they are built. */
export default function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <Empty title="Coming in the next build" icon={<Hammer className="size-5" />}>
        {description}
      </Empty>
    </div>
  )
}
