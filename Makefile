.PHONY: build build-strict clean

BUILD = Russian in Hoi An/build
DIST = Russian in Hoi An/dist

build:
	python3 "$(BUILD)/build.py"

build-strict:
	python3 "$(BUILD)/build.py" --require-pandoc

clean:
	rm -rf "$(DIST)" "$(BUILD)/dist"
