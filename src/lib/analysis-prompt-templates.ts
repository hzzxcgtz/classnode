// 模板目录；正文通过后端从官网读取，不随应用打包。
export const ANALYSIS_PROMPT_TEMPLATES = [
  {
    "id": "primary-chinese",
    "stage": "primary",
    "subject": "chinese",
    "title": "小学语文",
    "file": "/prompt-templates/analysis/primary-chinese.md"
  },
  {
    "id": "primary-math",
    "stage": "primary",
    "subject": "math",
    "title": "小学数学",
    "file": "/prompt-templates/analysis/primary-math.md"
  },
  {
    "id": "primary-english",
    "stage": "primary",
    "subject": "english",
    "title": "小学英语",
    "file": "/prompt-templates/analysis/primary-english.md"
  },
  {
    "id": "primary-science",
    "stage": "primary",
    "subject": "science",
    "title": "小学科学",
    "file": "/prompt-templates/analysis/primary-science.md"
  },
  {
    "id": "primary-information-technology",
    "stage": "primary",
    "subject": "information-technology",
    "title": "小学信息科技",
    "file": "/prompt-templates/analysis/primary-information-technology.md"
  },
  {
    "id": "primary-general",
    "stage": "primary",
    "subject": "general",
    "title": "小学其他学科通用",
    "file": "/prompt-templates/analysis/primary-general.md"
  },
  {
    "id": "middle-chinese",
    "stage": "middle",
    "subject": "chinese",
    "title": "初中语文",
    "file": "/prompt-templates/analysis/middle-chinese.md"
  },
  {
    "id": "middle-math",
    "stage": "middle",
    "subject": "math",
    "title": "初中数学",
    "file": "/prompt-templates/analysis/middle-math.md"
  },
  {
    "id": "middle-english",
    "stage": "middle",
    "subject": "english",
    "title": "初中英语",
    "file": "/prompt-templates/analysis/middle-english.md"
  },
  {
    "id": "middle-science",
    "stage": "middle",
    "subject": "science",
    "title": "初中科学",
    "file": "/prompt-templates/analysis/middle-science.md"
  },
  {
    "id": "middle-information-technology",
    "stage": "middle",
    "subject": "information-technology",
    "title": "初中信息科技",
    "file": "/prompt-templates/analysis/middle-information-technology.md"
  },
  {
    "id": "middle-general",
    "stage": "middle",
    "subject": "general",
    "title": "初中其他学科通用",
    "file": "/prompt-templates/analysis/middle-general.md"
  }
] as const;
export const ANALYSIS_TEMPLATE_STAGES = [{id:'primary',label:'小学'},{id:'middle',label:'初中'}] as const;
export const ANALYSIS_TEMPLATE_SUBJECTS = [{"id":"chinese","label":"语文"},{"id":"math","label":"数学"},{"id":"english","label":"英语"},{"id":"science","label":"科学"},{"id":"information-technology","label":"信息科技"},{"id":"general","label":"其他学科通用"}] as const;
