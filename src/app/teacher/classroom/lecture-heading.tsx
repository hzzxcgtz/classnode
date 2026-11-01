import { IconFileSearch, IconMessageSearch } from '@tabler/icons-react';
import styles from './fullscreen-preview.module.css';

/** Visible heading is independent of stored annotation identities. */
export function LectureHeading({studentName,mode}:{studentName:string;mode:'answer'|'review'}) {
 const Icon=mode==='answer'?IconFileSearch:IconMessageSearch;
 return <span className={styles.lectureHeading} data-mode={mode}>
  <span className={styles.lectureHeadingIcon} aria-hidden="true"><Icon size={22} stroke={1.7}/></span>
  <span className={styles.lectureHeadingWords}>{mode==='review'&&'给'}<strong>{studentName.endsWith('同学') ? studentName : `${studentName}同学`}</strong>{mode==='answer'?'的本题作答':'的评价与建议'}</span>
 </span>;
}
