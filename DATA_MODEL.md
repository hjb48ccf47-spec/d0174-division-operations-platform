# D0174 資料模型

## 隔離規則

資料只在瀏覽器的 `d0174-platform-state-v1` 命名空間保存，根節點固定為：

```json
{
  "version": 1,
  "divisionId": "D0174",
  "members": [],
  "newcomers": [],
  "attendance": [],
  "meetings": [],
  "leavers": [],
  "logs": [],
  "reportUploads": []
}
```

所有新增、修改、刪除、匯入、匯出與報表上傳記錄都由前端限制在 `D0174`。匯入 JSON 若不是 `divisionId = D0174` 會被拒絕，避免把其他分區資料載入此平台。

## 功能資料

- `members`：姓名、Agent Code、職級／角色、分組、直接上線、狀態、檔案完成度。
- `newcomers`：入職月份、日期、負責人，以及文件、第一週、30／60／90 日節點。
- `attendance`：月份、人員、出勤狀態、年度出勤率、業績金額、行政區。
- `meetings`：月份、日期、主題、備註、簽到人員。
- `leavers`：月份、最後工作日、原因、負責人，以及五個交接／權限回收節點。
- `reportUploads`：檔名、檔案類型、保留功能、月份、上傳時間；不保存 D0133 表格或資料內容。
