// The event editor's fields and controls (markup: src/components/EventEditorModal.astro).

export const modal = document.getElementById('event-modal')!;
export const modalHeading = document.getElementById('modal-heading')!;
export const titleInput = document.getElementById('event-title') as HTMLInputElement;
export const dateInput = document.getElementById('event-date') as HTMLInputElement;
export const startTimeInput = document.getElementById('event-start-time') as HTMLInputElement;
export const endTimeInput = document.getElementById('event-end-time') as HTMLInputElement;
export const descriptionInput = document.getElementById('event-description') as HTMLElement;
// `let` so restorePlainLocationInput() can swap in a clean copy.
export let locationInput = document.getElementById('event-location') as HTMLInputElement;
export function setLocationInput(input: HTMLInputElement) {
  locationInput = input;
}
export const priceWholeSeriesInput = document.getElementById('event-price-whole-series') as HTMLInputElement;
export const priceDropInInput = document.getElementById('event-price-drop-in') as HTMLInputElement;
export const priceStudentInput = document.getElementById('event-price-student') as HTMLInputElement;
export const priceWholeSeriesEarlyBirdInput = document.getElementById('event-price-whole-series-early-bird') as HTMLInputElement;
export const priceDropInEarlyBirdInput = document.getElementById('event-price-drop-in-early-bird') as HTMLInputElement;
export const priceStudentEarlyBirdInput = document.getElementById('event-price-student-early-bird') as HTMLInputElement;
export const earlyBirdUntilInput = document.getElementById('event-early-bird-until') as HTMLInputElement;
export const priceWholeSeriesFlashSaleInput = document.getElementById('event-price-whole-series-flash-sale') as HTMLInputElement;
export const priceDropInFlashSaleInput = document.getElementById('event-price-drop-in-flash-sale') as HTMLInputElement;
export const priceStudentFlashSaleInput = document.getElementById('event-price-student-flash-sale') as HTMLInputElement;
export const flashSaleUntilInput = document.getElementById('event-flash-sale-until') as HTMLInputElement;
// Whether the homepage says when each deal ends (on), or just names it.
export const showEarlyBirdEndInput = document.getElementById('event-show-early-bird-end') as HTMLInputElement;
export const showFlashSaleEndInput = document.getElementById('event-show-flash-sale-end') as HTMLInputElement;
export const registrationClosedInput = document.getElementById('event-registration-closed') as HTMLInputElement;
export const lessonOverviewTitleInput = document.getElementById('event-lesson-overview-title') as HTMLInputElement;
export const lessonOverviewBodyInput = document.getElementById('event-lesson-overview-body') as HTMLElement;
export const hideLessonOverviewInput = document.getElementById('event-hide-lesson-overview') as HTMLInputElement;
export const lessonOverviewFields = document.getElementById('event-lesson-overview-fields')!;
export const imageUrlInput = document.getElementById('event-image-url') as HTMLInputElement;
export const imageFileInput = document.getElementById('event-image-file') as HTMLInputElement;
export const imagePreview = document.getElementById('event-image-preview') as HTMLImageElement;
export const imageUploadLabel = document.getElementById('event-image-upload-label')!;
export const imageRemoveBtn = document.getElementById('event-image-remove') as HTMLButtonElement;
export const imageError = document.getElementById('event-image-error')!;
export const privateInput = document.getElementById('event-private') as HTMLInputElement;
export const capacityInput = document.getElementById('event-capacity') as HTMLInputElement;
export const showCapacityInput = document.getElementById('event-show-capacity') as HTMLInputElement;
export const capacityByRoleToggle = document.getElementById('event-capacity-by-role') as HTMLButtonElement;
export const capacityByRoleRow = document.getElementById('event-capacity-by-role-row')!;
export const capacityGeneralRow = document.getElementById('event-capacity-general')!;
export const capacityRolesRow = document.getElementById('event-capacity-roles')!;
export const leaderCapacityInput = document.getElementById('event-leader-capacity') as HTMLInputElement;
export const followerCapacityInput = document.getElementById('event-follower-capacity') as HTMLInputElement;
export const priceWholeLabel = document.getElementById('event-price-whole-label')!;
export const classOnlyPriceEls = Array.from(document.querySelectorAll<HTMLElement>('.class-only-price'));
export const repeatInput = document.getElementById('event-repeat') as HTMLInputElement;
export const repeatOptions = document.getElementById('event-repeat-options')!;
export const repeatIntervalInput = document.getElementById('event-repeat-interval') as HTMLInputElement;
export const repeatDayButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.repeat-day-btn'));
export const repeatCountInput = document.getElementById('event-repeat-count') as HTMLInputElement;
export const repeatUntilInput = document.getElementById('event-repeat-until') as HTMLInputElement;
export const repeatEndRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="repeat-end"]'));
export const recurrenceRow = document.getElementById('event-recurrence-row')!;
export const recurrenceHint = document.getElementById('event-recurrence-hint')!;
export const deleteBtn = document.getElementById('event-delete')!;
export const deleteSeriesBtn = document.getElementById('event-delete-series')!;
export const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.event-type-btn'));
export const colorPicker = document.getElementById('event-color-picker') as HTMLInputElement;
export const recentColorsRow = document.getElementById('event-recent-colors')!;
export const syncIndicator = document.getElementById('sync-indicator')!;
export const syncIndicatorText = document.getElementById('sync-indicator-text')!;
