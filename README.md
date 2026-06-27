# Upbit KRW Market Scanner

업비트 KRW 마켓 코인을 조건으로 검색하는 정적 웹앱입니다.

## 주요 기능

- 업비트 KRW 마켓 전체 대상 검색
- 비트코인 현재가, 당일 변동률, 당일 변동액 상단 고정 표시
- Binance USDT 기준 TradingView 차트 표시
- TradingView 차트에 이동평균선과 거래량 보조지표 표시
- 24시간 변동률, 거래대금, 현재가, 이동평균, 거래량 배수 조건 검색
- 검색 결과 CSV 내보내기

## 로컬 실행

```powershell
node local-server.js
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:5178/
```

## GitHub Pages

GitHub Pages에는 아래 파일만 올리면 됩니다.

```text
index.html
app.js
styles.css
README.md
```

`local-server.js`는 로컬 테스트용입니다.

## 참고

차트는 Binance의 `코인심볼USDT` 기준으로 표시합니다. Binance에 해당 심볼이 없는 코인은 TradingView 차트가 표시되지 않을 수 있습니다.
