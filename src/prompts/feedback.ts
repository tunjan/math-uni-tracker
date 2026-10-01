import { feedbackLines } from '@/lib/store/gradings'

/** Weak points from your accepted AI gradings on these items, newest first. */
export const recentFeedback = (courseKey: string, itemIds: string[]) => feedbackLines(courseKey, itemIds)
