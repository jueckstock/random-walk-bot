#!/usr/bin/env python3
import csv
import json
import sys
from collections import Counter


def main(argv):
    out = csv.writer(sys.stdout, dialect="excel-tab", lineterminator="\n")
    ctr = Counter()
    for line in sys.stdin:
        data = json.loads(line)
        ctr.update(dict(data))

    for key, count in ctr.most_common(25):
        out.writerow((key, count))


if __name__ == "__main__":
    main(sys.argv)
