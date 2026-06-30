# company_calendar 공휴일 갱신 절차 (연 1회)

작성: Claude code(토심이) / 2026-06-30

## 목적
`company_calendar`는 연차 **근무일 차감**의 권위 소스(서버 함수·클라이언트 공통). 해마다 다음 연도 공휴일을 미리 seed해야 그 해 신청이 정확히 계산된다. 현재 적재: **2025·2026·2027·2028**.

## 갱신 시점
- **매년 4분기(10~12월)에 다음다음 해**를 seed해 2년치 여유 유지 권장(예: 2026년 말 → 2028까지 확보됨, 2027년 말 → 2029 seed).
- 정부(인사혁신처)가 익년 관공서 공휴일·대체공휴일을 통상 전년에 확정 공고하므로 4분기 확보 가능.

## 절차
1. **검증된 목록 확보**(추측 금지): 권위 페이지에서 해당 연도 법정공휴일+대체공휴일을 YYYY-MM-DD로 확인. 사용처 예: kholidayz.com/year/{년}, 인사혁신처 공고, 공공데이터포털 특일정보 API.
2. **규칙 적용**:
   - **포함**: 신정·삼일절·**근로자의날(5/1, 회사 휴무)**·어린이날·부처님오신날(음력)·현충일·광복절·설/추석 연휴 전체·개천절·한글날·크리스마스 + **모든 대체공휴일**.
   - **제외**: **제헌절(7/17)** = 2008년 이후 비휴무(근무일). 기타 기념일(식목일·스승의날 등) 비휴무.
   - 음력(설·추석·부처님오신날)·대체공휴일·선거일은 **반드시 확정 날짜로만**.
3. **seed 마이그레이션** 작성(timestamp 네이밍, `on conflict (cal_date) do nothing`):
   ```sql
   insert into public.company_calendar (cal_date, holiday_name) values
   ('YYYY-01-01','신정'), ... 
   on conflict (cal_date) do nothing;
   ```
   파일 = `supabase/migrations/{version}_company_calendar_{년}_holidays.sql`. 적용은 `apply_migration`(자체 version 부여 → 파일명을 실제 version으로 정합).
4. **검증**: `select count(*) from company_calendar where extract(year from cal_date)={년};` 로 행수 확인(연 16건 안팎). 임시·대체공휴일 신규 지정 시 추가 seed.

## 예시 이력
- 2027: migration `20260630114221`(21행, 제헌절 제외).
- 2028: migration `20260630120638`(16행, 개천절 추석겹침→대체 10/5).

## 비고
- 회사 임시휴무·창립기념일 등 **회사 고유 휴무**도 같은 표에 `is_holiday=true`로 추가 가능(holiday_name에 사유 표기).
- 자동화(Google `ko.south_korea#holiday` → company_calendar 동기화) 도입 시 **반드시 승인/검토 단계**를 둔다(잘못된 공휴일·기념일 자동 유입 방지). 현재는 수동 seed가 표준.
