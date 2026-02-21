"""
Gemini API를 사용해 음식 이미지를 생성하는 스크립트

사용법:
    python3 generate_image.py "요리이름" "저장할경로"

예시:
    python3 generate_image.py "치즈 계란말이" "./cheese_egg_roll.png"
"""

import sys
import json
import base64
import urllib.request
import urllib.error

# ===== 설정 =====
API_KEY = "AIzaSyAvWTXB3nnQmivzUR8efAjqyDCzcWBBY1g"
MODEL = "gemini-2.0-flash-exp-image-generation"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"


def generate_food_image(dish_name, save_path):
    """
    Gemini API로 음식 이미지를 생성하고 파일로 저장합니다.

    매개변수:
        dish_name (str): 요리 이름 (예: "치즈 계란말이")
        save_path (str): 이미지를 저장할 파일 경로

    반환값:
        bool: 성공하면 True, 실패하면 False
    """

    # 1단계: API 요청 데이터 준비
    prompt = (
        f"Generate a delicious and appetizing food photo of {dish_name}. "
        f"Beautifully plated on a clean white dish. "
        f"Warm lighting, professional food photography style, high quality."
    )

    request_body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
    }

    # 2단계: API 호출
    try:
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(request_body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        print(f"이미지 생성 중: {dish_name} ...")

        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as e:
        print(f"API 오류: {e.code} - {e.reason}")
        return False
    except Exception as e:
        print(f"요청 실패: {e}")
        return False

    # 3단계: 응답에서 이미지 추출 및 저장
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "inlineData" in part:
                img_bytes = base64.b64decode(part["inlineData"]["data"])
                with open(save_path, "wb") as f:
                    f.write(img_bytes)
                size_kb = len(img_bytes) / 1024
                print(f"이미지 저장 완료: {save_path} ({size_kb:.0f}KB)")
                return True

    print("이미지를 생성하지 못했습니다.")
    return False


# ===== 스크립트 실행 =====
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python3 generate_image.py '요리이름' '저장경로'")
        print("예시:   python3 generate_image.py '치즈 계란말이' './image.png'")
        sys.exit(1)

    dish = sys.argv[1]
    path = sys.argv[2]

    success = generate_food_image(dish, path)
    sys.exit(0 if success else 1)
