import { todayISO } from './dates'
import { downloadBlob } from './download'
import { exportAll } from './store/backup'

/** Download everything as one zip, and record the date for the 14-day reminder. */
export async function downloadBackup() {
  const zip = await exportAll()
  downloadBlob(`course-planner-backup-${todayISO()}.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }))
}
