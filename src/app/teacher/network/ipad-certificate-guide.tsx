import steps from '../../../../public/guides/ipad-recording/steps.json';
import styles from './network.module.css';

export function IpadCertificateGuide() {
  return <section className={styles.walkthrough} aria-labelledby="ipad-guide-title">
    <div className={styles.stepTitle}><h3 id="ipad-guide-title">照着做：iPad 首次录音设置</h3></div>
    <p className={styles.intro}>每台学生设备分别操作一次。先安装，再信任，最后试录；菜单名称可能随系统版本略有不同。</p>
    <ol className={styles.guideSteps}>{steps.map((step, index) => <li key={step.title}>
      <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
      <div className={styles.stepContent}><h4>{step.title}</h4><p>{step.text}</p><p className={styles.stepNote}>{step.note}</p>
        {step.images.length > 0 && <div className={styles.guidePhotos}>{step.images.map(photo => <figure key={photo.file}>
          <a href={`/guides/ipad-recording/${photo.file}`} target="_blank" rel="noreferrer" aria-label={`${photo.caption}，打开大图`}><img src={`/guides/ipad-recording/${photo.file}`} alt={photo.alt} loading="lazy" /></a><figcaption>{photo.caption}</figcaption>
        </figure>)}</div>}
      </div>
    </li>)}</ol>
    <p className={styles.sourceNote}>图中 IP、证书名称末尾字符仅为示例，以当前教师电脑为准。参考：<a href="https://support.apple.com/zh-cn/102400" target="_blank" rel="noreferrer">Apple 安装说明</a> · <a href="https://support.apple.com/zh-cn/102390" target="_blank" rel="noreferrer">Apple 信任说明</a></p>
  </section>;
}
