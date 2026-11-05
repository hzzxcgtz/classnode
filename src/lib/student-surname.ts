export function chineseStudentSurname(name: string): string | null {
  const compound = ['欧阳', '司马', '上官', '诸葛', '夏侯', '东方', '皇甫', '尉迟', '公孙', '慕容', '令狐', '宇文', '长孙', '司徒', '司空', '南宫', '端木', '独孤', '钟离', '澹台', '申屠', '公羊', '闻人', '赫连', '百里', '东郭', '呼延', '万俟', '仲孙', '宗政', '濮阳', '太史', '公冶', '公良', '段干', '闾丘', '第五'];
  return /^[\p{Script=Han}]+$/u.test(name)
    ? compound.find(prefix => name.startsWith(prefix)) ?? Array.from(name)[0]
    : null;
}
