import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function ConfirmDelete({ what, detail, onConfirm, children }: { what: string; detail: string; onConfirm: () => void; children: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {children(() => setOpen(true))}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {what}?</AlertDialogTitle>
            <AlertDialogDescription>{detail} This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { onConfirm(); setOpen(false) }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export const DeleteButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} className="shrink-0 text-muted-foreground hover:text-destructive">
    <Trash2 />
  </Button>
)
